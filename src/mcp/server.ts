#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { configuredPlatforms, ENV_VARS, getAdapter, workspaceFor } from "../adapters/index.js";
import { checkCampaign, findItem } from "../checks/campaign.js";
import { CHECKS } from "../checks/catalog.js";
import { checkChannelMessage } from "../checks/channels.js";
import { checkEmail } from "../checks/email.js";
import { learnFromEmail } from "../checks/house.js";
import { findOverlaps, whatBreaks } from "../core/graph.js";
import { evaluateHealth, THRESHOLDS } from "../core/health.js";
import { checkJourneyStructure, journeyDiagram } from "../core/journey.js";
import type { Platform } from "../core/model.js";
import { bulkEditPreview, opsReport } from "../core/ops.js";
import { loadRules, LOCKED_CHECKS, saveRules } from "../core/rules.js";
import { carryForwardSeenAudiences, diffSnapshots, homeDir, isActive, loadLatest, saveSnapshot, updateLatest, type Snapshot } from "../core/snapshot.js";
import { demoSnapshot } from "../demo/fernbrook.js";
import { howTo } from "../guides/howto.js";
import { TASKS, type TaskId } from "../guides/types.js";

// Read the version from the plugin manifest at runtime, so a release bump never changes dist/.
function pluginVersion(): string {
  try {
    const manifest = join(dirname(fileURLToPath(import.meta.url)), "../.claude-plugin/plugin.json");
    return (JSON.parse(readFileSync(manifest, "utf8")) as { version: string }).version;
  } catch {
    return "unknown";
  }
}
const VERSION = pluginVersion();

// Local-only usage log: tool names, check ids and counts, never email content. Feeds /ops-report.
async function logRun(entry: Record<string, unknown>): Promise<void> {
  try {
    await mkdir(homeDir(), { recursive: true });
    await appendFile(join(homeDir(), "qa-log.jsonl"), JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n");
  } catch {
    // Logging must never break a check.
  }
}

/** Only local email files: keeps the tool from reading arbitrary files (keys, configs) on request. */
async function readEmailFile(path: string): Promise<string> {
  if (!/\.(html?|txt)$/i.test(path)) throw new Error("Only .html, .htm or .txt files can be checked.");
  const { size } = await stat(path);
  if (size > 5 * 1024 * 1024) throw new Error("That file is over 5 MB; it doesn't look like an email.");
  return readFile(path, "utf8");
}

const json = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }] });
const fail = (text: string) => ({ isError: true, content: [{ type: "text" as const, text }] });

const platformArg = z.enum(["braze", "klaviyo", "iterable"]).describe("Which platform.");
const workspaceArg = z.string().optional().describe('Workspace label. Defaults to the connected one, or "demo" when nothing is connected.');

function resolveWorkspace(platform: Platform, workspace?: string): string {
  if (workspace) return workspace;
  return configuredPlatforms().includes(platform) ? workspaceFor(platform) : "demo";
}

async function latest(platform: Platform, workspace?: string): Promise<Snapshot> {
  const ws = resolveWorkspace(platform, workspace);
  const { latest } = await loadLatest(platform, ws);
  if (!latest) throw new Error(`No snapshot of ${platform} (${ws}) yet. Run /refresh first${ws === "demo" ? ", or refresh with demo: true to try the demo account" : ""}.`);
  return latest;
}

const server = new McpServer({ name: "crm-lifecycle-ops", version: VERSION });
const tool = server.registerTool.bind(server);

// ---------------------------------------------------------------- QA

const persona = z.object({
  name: z.string(),
  attributes: z.record(z.string(), z.unknown()).describe('Attribute values keyed by path, e.g. {"first_name": "Ana", "custom_attribute.loyalty_tier": "Gold"}'),
});

tool(
  "check_email",
  {
    title: "Check an email",
    description:
      "QA one email before it sends, using the team's house rules: HTML structure, Outlook conditionals, Gmail clipping, alt text, links " +
      "(non-production hosts, unsubscribe, UTMs, approved domains), personalization rendered for several synthetic personas, subject line, " +
      "sender, brand terms, spelling variant and required footer text. Pass HTML or a local file path. Read-only; sends nothing.",
    inputSchema: {
      html: z.string().optional().describe("The email HTML, including template tags."),
      file: z.string().optional().describe("Absolute path to a local .html file, used when html is not given."),
      platform: platformArg.describe("Which platform's template language the email uses."),
      name: z.string().optional(),
      subject: z.string().optional(),
      preheader: z.string().optional(),
      from: z.string().optional().describe("Sender email address."),
      transactional: z.boolean().optional().describe("Receipts, password resets and other transactional mail: skips the unsubscribe requirement."),
      personas: z.array(persona).optional().describe("Synthetic test profiles. Leave empty to use the team's personas or auto-generated ones."),
      check_links_live: z.boolean().optional().describe("Also check each link over the network (HEAD requests only; unsubscribe and click-tracking links are never requested)."),
    },
  },
  async (args) => {
    const html = args.html ?? (args.file ? await readEmailFile(args.file) : undefined);
    if (!html) return fail("Give either `html` or `file`.");
    const { rules, exists } = await loadRules();
    const report = await checkEmail(
      { html, platform: args.platform, name: args.name ?? args.file, subject: args.subject, preheader: args.preheader, from: args.from, transactional: args.transactional, personas: args.personas, checkLinksLive: args.check_links_live },
      rules,
    );
    await logRun({ tool: "check_email", platform: report.platform, summary: report.summary, checkIds: report.findings.map((f) => f.checkId) });
    return json({ ...report, houseRules: exists ? "applied" : "none yet: run /setup to teach it your team's conventions" });
  },
);

tool(
  "check_message",
  {
    title: "Check a push, SMS or in-app message",
    description:
      "QA one push notification, SMS/MMS or in-app message using the team's house rules: renders personalization for several synthetic personas, " +
      "then checks length against lock-screen / segment / in-app limits, SMS encoding and billed segments, opt-out wording and sender name, " +
      "deep links and other links (non-production hosts, malformed URIs), buttons, brand terms and spelling. Read-only; sends nothing.",
    inputSchema: {
      channel: z.enum(["push", "sms", "in-app"]),
      platform: platformArg.describe("Which platform's template language the message uses."),
      body: z.string().describe("Push body/alert, SMS text, or in-app message body (text or HTML)."),
      title: z.string().optional().describe("Push title or in-app header."),
      deep_link: z.string().optional().describe("Tap-through destination: deep link or URL."),
      image_url: z.string().optional(),
      buttons: z.array(z.object({ text: z.string(), link: z.string().optional() })).optional().describe("In-app buttons."),
      name: z.string().optional(),
      personas: z.array(persona).optional(),
    },
  },
  async (args) => {
    const { rules, exists } = await loadRules();
    const report = await checkChannelMessage(
      { channel: args.channel, platform: args.platform, name: args.name, title: args.title, body: args.body, deepLink: args.deep_link, imageUrl: args.image_url, buttons: args.buttons, personas: args.personas },
      rules,
    );
    await logRun({ tool: "check_message", channel: args.channel, platform: args.platform, summary: report.summary, checkIds: report.findings.map((f) => f.checkId) });
    return json({ ...report, houseRules: exists ? "applied" : "none yet: run /setup to teach it your team's conventions" });
  },
);

tool(
  "check_campaign",
  {
    title: "Check a campaign or journey",
    description: "QA every message in a campaign or journey (Canvas/flow): emails with content blocks expanded, push, SMS and in-app, plus its settings: audience, conversion events, naming and journey structure (dead ends, unreachable steps).",
    inputSchema: { platform: platformArg, workspace: workspaceArg, name_or_id: z.string() },
  },
  async ({ platform, workspace, name_or_id }) => {
    const snap = await latest(platform, workspace);
    const { rules } = await loadRules();
    const result = await checkCampaign(snap, name_or_id, rules);
    if ("settings" in result && result.settings && result.messages) await logRun({ tool: "check_campaign", platform, summary: result.summary, checkIds: [...result.settings, ...result.messages.flatMap((m) => m.findings)].map((f) => f.checkId) });
    return json(result);
  },
);

tool(
  "list_checks",
  {
    title: "List all checks",
    description: "Every check, with its id, default severity and what it catches, plus which ones are locked (can't be turned off). Use to explain a finding or fill in a problem report.",
    inputSchema: {},
  },
  async () => json({ version: VERSION, locked: [...LOCKED_CHECKS], checks: CHECKS }),
);

// ---------------------------------------------------------------- house rules

tool(
  "get_house_rules",
  { title: "Show house rules", description: "The team's rulebook (what counts as right for them) and where it's stored. Returns defaults if /setup hasn't run.", inputSchema: {} },
  async () => {
    const { rules, path, exists } = await loadRules();
    return json({ exists, path, rules, locked: [...LOCKED_CHECKS] });
  },
);

tool(
  "save_house_rules",
  {
    title: "Save house rules",
    description: "Replace the team's rulebook. Always show the person the changes and get a yes first. Locked checks can't be overridden. Schema: locale, brand, links, compliance, senders, personalization, style, naming, severity, exceptions.",
    inputSchema: { rules: z.record(z.string(), z.unknown()).describe("The full rulebook object (get it with get_house_rules, edit, save).") },
  },
  async ({ rules }) => {
    try {
      const saved = await saveRules(rules);
      await logRun({ tool: "save_house_rules" });
      return json({ saved: true, ...saved });
    } catch (e) {
      return fail(`Not saved: ${(e as Error).message}`);
    }
  },
);

tool(
  "add_exception",
  {
    title: "Mark a finding as fine for us",
    description: "Record that a finding is acceptable for this team (not a tool bug), with a reason. Optionally scoped by `match` text. Locked checks can't be waived. For tool bugs use /report-problem instead.",
    inputSchema: { check_id: z.string(), reason: z.string(), match: z.string().optional().describe("Only waive findings whose message/evidence contains this text.") },
  },
  async ({ check_id, reason, match }) => {
    if (LOCKED_CHECKS.has(check_id)) return fail(`${check_id} is locked: it's wrong for every team, so it can't be waived.`);
    const { rules } = await loadRules();
    rules.exceptions.push({ checkId: check_id, reason, match, addedAt: new Date().toISOString() });
    const saved = await saveRules(rules);
    return json({ saved: true, path: saved.path, exceptions: saved.rules.exceptions });
  },
);

tool(
  "learn_from_email",
  {
    title: "Learn conventions from a good email",
    description: "Read an email the team considers correct and propose house rules from it: link domains, UTM params and values, sender, name fallback, US/GB spelling, subject style, footer and postal address. Proposals only; confirm with the person before saving.",
    inputSchema: { html: z.string().optional(), file: z.string().optional(), subject: z.string().optional(), from: z.string().optional() },
  },
  async (args) => {
    const html = args.html ?? (args.file ? await readEmailFile(args.file) : undefined);
    if (!html) return fail("Give either `html` or `file`.");
    return json(learnFromEmail({ html, subject: args.subject, from: args.from }));
  },
);

// ---------------------------------------------------------------- connect & refresh

tool(
  "connection_status",
  {
    title: "Connection status",
    description: "Which platforms have keys set (keys themselves are never shown), test each connection, and list the environment variables each platform needs.",
    inputSchema: { test: z.boolean().optional().describe("Also make one read-only call per connected platform.") },
  },
  async ({ test }) => {
    const connected = configuredPlatforms();
    const results: Record<string, unknown> = {};
    for (const p of Object.keys(ENV_VARS) as Platform[]) {
      if (!connected.includes(p)) {
        results[p] = { connected: false, needs: ENV_VARS[p].required, optional: ENV_VARS[p].optional };
        continue;
      }
      if (!test) {
        results[p] = { connected: true, workspace: workspaceFor(p) };
        continue;
      }
      try {
        results[p] = { connected: true, workspace: workspaceFor(p), check: await getAdapter(p).ping() };
      } catch (e) {
        results[p] = { connected: false, workspace: workspaceFor(p), error: (e as Error).message };
      }
    }
    return json(results);
  },
);

tool(
  "refresh_account",
  {
    title: "Refresh account snapshot",
    description: "Pull the latest campaigns, journeys, segments, templates and content blocks into a local snapshot (read-only API calls), then report what changed since the previous one. Set demo: true to load the fictional Fernbrook Market demo account instead.",
    inputSchema: { platform: platformArg, demo: z.boolean().optional() },
  },
  async ({ platform, demo }) => {
    try {
      let snap: Snapshot;
      if (demo) {
        if (platform !== "braze") return fail("The demo account is a Braze workspace; use platform: braze.");
        snap = demoSnapshot();
      } else {
        const adapter = getAdapter(platform);
        const { latest: prev } = await loadLatest(platform, adapter.workspace);
        snap = await adapter.snapshot(prev);
      }
      const { latest: prev } = await loadLatest(platform, snap.workspace);
      carryForwardSeenAudiences(prev, snap);
      const file = await saveSnapshot(snap);
      const changes = prev ? diffSnapshots(prev, snap) : [];
      await logRun({ tool: "refresh_account", platform });
      return json({
        workspace: snap.workspace,
        savedTo: file,
        counts: {
          campaigns: snap.campaigns.length,
          liveCampaigns: snap.campaigns.filter((c) => isActive(c.status)).length,
          journeys: snap.journeys.length,
          liveJourneys: snap.journeys.filter((j) => isActive(j.status)).length,
          messages: snap.messages.length,
          segmentsAndLists: snap.segments.length,
          contentBlocks: snap.contentBlocks.length,
        },
        gaps: snap.gaps,
        changesSincePrevious: prev ? changes.slice(0, 30) : "first snapshot",
      });
    } catch (e) {
      return fail((e as Error).message);
    }
  },
);

tool(
  "list_items",
  {
    title: "Find campaigns, journeys, segments or blocks",
    description: "Search the latest snapshot by name. Use it to resolve what the person means before checking, mapping or analysing impact.",
    inputSchema: {
      platform: platformArg,
      workspace: workspaceArg,
      kind: z.enum(["campaign", "journey", "segment", "content-block", "message", "all"]).optional(),
      query: z.string().optional(),
      active_only: z.boolean().optional(),
      limit: z.number().int().positive().max(500).optional().describe("Max results per kind (default 50)."),
    },
  },
  async ({ platform, workspace, kind = "all", query, active_only, limit = 50 }) => {
    const snap = await latest(platform, workspace);
    const q = (query ?? "").toLowerCase();
    const match = (name: string) => name.toLowerCase().includes(q);
    const out: Record<string, unknown> = { snapshotTakenAt: snap.takenAt, limitPerKind: limit };
    const cap = <T,>(xs: T[]) => xs.slice(0, limit);
    if (kind === "all" || kind === "campaign") out.campaigns = cap(snap.campaigns.filter((c) => match(c.name) && (!active_only || isActive(c.status))).map(({ id, name, status, channels }) => ({ id, name, status, channels })));
    if (kind === "all" || kind === "journey") out.journeys = cap(snap.journeys.filter((j) => match(j.name) && (!active_only || isActive(j.status))).map(({ id, name, status, steps }) => ({ id, name, status, steps: steps.length })));
    if (kind === "all" || kind === "segment") out.segments = cap(snap.segments.filter((s) => match(s.name)).map(({ id, name, kind: k, description }) => ({ id, name, kind: k, description })));
    if (kind === "all" || kind === "content-block") out.contentBlocks = cap(snap.contentBlocks.filter((b) => match(b.name)).map(({ id, name, usedBy }) => ({ id, name, usedIn: usedBy.length })));
    if (kind === "message") out.messages = cap(snap.messages.filter((m) => match(m.name) || match(m.subject ?? "")).map(({ id, name, subject, ownerId }) => ({ id, name, subject, ownerId })));
    return json(out);
  },
);

tool(
  "record_audience",
  {
    title: "Record an audience seen on screen",
    description: "Fill an API gap: record which segment/list a campaign or journey targets, as read from the platform's dashboard (e.g. via Claude in Chrome). Stored as 'seen-on-screen' with today's date on the latest snapshot.",
    inputSchema: { platform: platformArg, workspace: workspaceArg, item: z.string().describe("Campaign or journey name or id."), segment: z.string().describe("Segment or list name or id."), mode: z.enum(["include", "exclude"]).optional() },
  },
  async ({ platform, workspace, item, segment, mode = "include" }) => {
    const snap = await latest(platform, workspace);
    const found = findItem(snap, item);
    if ("candidates" in found) return fail(`Couldn't pin down "${item}". Candidates: ${found.candidates.join("; ") || "none"}`);
    const seg = snap.segments.find((s) => s.id === segment || s.name.toLowerCase() === segment.toLowerCase());
    if (!seg) return fail(`No segment or list called "${segment}" in the snapshot. Run /refresh if it's new.`);
    found.item.audience = [
      ...found.item.audience.filter((a) => a.confidence !== "unknown"),
      { id: seg.id, kind: seg.kind, mode, confidence: "seen-on-screen", seenAt: new Date().toISOString() },
    ];
    // Update the newest snapshot in place, so /what-changed still compares real refreshes.
    await updateLatest(snap);
    return json({ recorded: true, item: found.item.name, audience: found.item.audience });
  },
);

// ---------------------------------------------------------------- impact

tool(
  "what_breaks",
  {
    title: "What breaks if I change this",
    description: "Everything that depends on an attribute, segment/list, content block, event, message or piece of text, live items first, each with how we know (api-verified, parsed from template, seen on screen…) and a list of live items we can't rule out.",
    inputSchema: {
      platform: platformArg,
      workspace: workspaceArg,
      kind: z.enum(["attribute", "segment", "list", "content-block", "event", "message", "text"]),
      value: z.string().describe("Name or id, e.g. loyalty_tier, VIP members, footer_v2, Order Placed, or a phrase/URL."),
    },
  },
  async ({ platform, workspace, kind, value }) => {
    const snap = await latest(platform, workspace);
    await logRun({ tool: "what_breaks", platform });
    return json({ snapshotTakenAt: snap.takenAt, ...whatBreaks(snap, kind, value) });
  },
);

tool(
  "what_changed",
  {
    title: "What changed in the account",
    description: "Differences between the latest snapshot and the previous one (or the newest one taken before `since`): added, removed, status changes, content, audience and structure edits. Live items first.",
    inputSchema: { platform: platformArg, workspace: workspaceArg, since: z.string().optional().describe("ISO date, e.g. 2026-11-01") },
  },
  async ({ platform, workspace, since }) => {
    const ws = resolveWorkspace(platform, workspace);
    const { latest: now, previous } = await loadLatest(platform, ws, since);
    if (!now) return fail("No snapshots yet. Run /refresh.");
    if (!previous) return fail("Only one snapshot so far, so there's nothing to compare. Run /refresh again later (or on a schedule).");
    const changes = diffSnapshots(previous, now);
    const byKind: Record<string, number> = {};
    for (const c of changes) byKind[c.kind] = (byKind[c.kind] ?? 0) + 1;
    return json({ from: previous.takenAt, to: now.takenAt, total: changes.length, byKind, liveChanges: changes.filter((c) => c.active).length, changes: changes.slice(0, 100), truncated: changes.length > 100 });
  },
);

// ---------------------------------------------------------------- plan

tool(
  "show_journey",
  {
    title: "Show a journey",
    description: "A Mermaid diagram of a live journey (Canvas/flow) with subject lines, plus structural problems (dead ends, unreachable steps, empty message steps).",
    inputSchema: { platform: platformArg, workspace: workspaceArg, name_or_id: z.string() },
  },
  async ({ platform, workspace, name_or_id }) => {
    const snap = await latest(platform, workspace);
    const found = findItem(snap, name_or_id);
    if ("candidates" in found) return fail(`Couldn't pin down "${name_or_id}". Candidates: ${found.candidates.join("; ") || "none"}`);
    if (found.kind !== "journey") return fail(`"${found.item.name}" is a single campaign, not a journey.`);
    const structure = checkJourneyStructure(found.item);
    return json({ name: found.item.name, status: found.item.status, mermaid: journeyDiagram(found.item, snap), ...structure });
  },
);

tool(
  "find_overlaps",
  {
    title: "Find overlaps with live programs",
    description: "For a planned journey or campaign: which live campaigns/journeys already target the same segments or lists, trigger on the same events, or use the same attributes, and which live items can't be ruled out.",
    inputSchema: {
      platform: platformArg,
      workspace: workspaceArg,
      segments: z.array(z.string()).optional(),
      lists: z.array(z.string()).optional(),
      events: z.array(z.string()).optional(),
      attributes: z.array(z.string()).optional(),
    },
  },
  async ({ platform, workspace, ...plan }) => json(findOverlaps(await latest(platform, workspace), plan)),
);

// ---------------------------------------------------------------- build

tool(
  "bulk_edit_preview",
  {
    title: "Preview a bulk edit",
    description: "Find text (or a regex) across every subject, preheader, body and content block and preview the replacement, live items first. Preview only; nothing is written.",
    inputSchema: { platform: platformArg, workspace: workspaceArg, find: z.string(), replace: z.string(), regex: z.boolean().optional(), active_only: z.boolean().optional() },
  },
  async ({ platform, workspace, find, replace, regex, active_only }) => {
    try {
      return json(bulkEditPreview(await latest(platform, workspace), find, replace, { regex, activeOnly: active_only }));
    } catch (e) {
      return fail((e as Error).message);
    }
  },
);

tool(
  "how_to",
  {
    title: "Platform-specific build or edit instructions",
    description:
      "Step-by-step instructions for a build or edit task in Braze, Klaviyo or Iterable, in that platform's own terms, from a procedure " +
      "library verified against the vendors' docs (with links). Filled in with the team's house rules (naming, sender, UTMs, fallback " +
      "syntax, footer, channel limits) and, when a snapshot exists, the account: segments and blocks to reuse, whether the target is live, " +
      "and shared content that would change other live programs. The plugin never edits the account; a person follows the steps. " +
      `Tasks: ${Object.entries(TASKS).map(([k, v]) => `${k} (${v})`).join("; ")}.`,
    inputSchema: {
      platform: platformArg,
      task: z.enum(Object.keys(TASKS) as [TaskId, ...TaskId[]]),
      workspace: workspaceArg,
      target: z.string().optional().describe("Existing campaign or journey being changed (edit tasks)."),
      channels: z.array(z.enum(["email", "push", "sms", "in-app"])).optional(),
      audience: z.string().optional().describe("Who it's for, in plain words, to find segments to reuse."),
      attributes: z.array(z.string()).optional().describe("Personalization attributes the copy will use."),
    },
  },
  async ({ platform, task, workspace, target, channels, audience, attributes }) => {
    const { rules } = await loadRules();
    const ws = resolveWorkspace(platform, workspace);
    const { latest: snap } = await loadLatest(platform, ws);
    await logRun({ tool: "how_to", platform, task });
    return json(howTo(platform, task, rules, snap, { target, channels, audience, attributes }));
  },
);

// ---------------------------------------------------------------- launch & report

tool(
  "launch_health",
  {
    title: "Launch health",
    description: "Recent delivery numbers for a campaign or journey (sent, delivered, bounces, unsubscribes, spam complaints, opens, clicks) judged against stated thresholds. Needs a connected account.",
    inputSchema: { platform: platformArg, name_or_id: z.string() },
  },
  async ({ platform, name_or_id }) => {
    try {
      const snap = await latest(platform);
      if (snap.demo) return fail("Launch health needs a connected account; the demo has no delivery data.");
      const found = findItem(snap, name_or_id);
      if ("candidates" in found) return fail(`Couldn't pin down "${name_or_id}". Candidates: ${found.candidates.join("; ") || "none"}`);
      const stats = await getAdapter(platform).launchStats(found.kind, found.item.id);
      const health = evaluateHealth(stats);
      await logRun({ tool: "launch_health", platform });
      return json({ name: found.item.name, status: found.item.status, stats, ...health, thresholds: THRESHOLDS });
    } catch (e) {
      return fail((e as Error).message);
    }
  },
);

tool(
  "ops_report",
  {
    title: "Ops report",
    description: "From the local usage log: emails checked, blocking problems caught, most common findings, weekly trend and estimated hours saved (assumption stated).",
    inputSchema: { days: z.number().int().positive().optional(), minutes_per_manual_check: z.number().positive().optional() },
  },
  async ({ days, minutes_per_manual_check }) => json(await opsReport(days, minutes_per_manual_check)),
);

await server.connect(new StdioServerTransport());
