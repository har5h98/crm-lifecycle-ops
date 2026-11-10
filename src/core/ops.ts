import { readdir, readFile } from "node:fs/promises";
import { userInfo } from "node:os";
import { join } from "node:path";
import { isActive, type Snapshot } from "./snapshot.js";
import { homeDir } from "./snapshot.js";

// /ops-report and /bulk-edit live here: both are read-only views over local data.

interface LogEntry {
  ts: string;
  tool: string;
  platform?: string;
  summary?: { fail: number; warn: number; info: number };
  checkIds?: string[];
  messages?: number;
  operator?: string;
}

/** Who ran a check, for team reports. The OS user name; override with CLO_OPERATOR. */
export function operatorName(): string {
  const set = process.env.CLO_OPERATOR;
  if (set && !set.startsWith("${")) return set;
  try {
    return userInfo().username;
  } catch {
    return "operator";
  }
}

/** Shared folder (e.g. a team drive) where every operator's log is mirrored. */
export function teamDir(): string | undefined {
  const d = process.env.CLO_TEAM_DIR;
  return d && !d.startsWith("${") && d.trim() ? d.trim() : undefined;
}

async function readLog(file: string): Promise<string[]> {
  try {
    return (await readFile(file, "utf8")).split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

export async function opsReport(days = 30, minutesPerManualCheck = 20, opts: { team?: boolean } = {}) {
  let lines: string[] = [];
  let scope = "this machine";
  if (opts.team) {
    const dir = teamDir();
    if (!dir)
      throw new Error(
        "No team report folder is set. Add one in /plugin configure crm-lifecycle-ops (a shared drive folder everyone can write to).",
      );
    const files = (await readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith(".jsonl"));
    for (const f of files) lines.push(...(await readLog(join(dir, f))));
    scope = `team folder (${files.length} operator${files.length === 1 ? "" : "s"})`;
  } else {
    lines = await readLog(join(homeDir(), "qa-log.jsonl"));
  }
  const since = Date.now() - days * 86_400_000;
  const entries = lines
    .map((l) => {
      try {
        return JSON.parse(l) as LogEntry;
      } catch {
        return undefined; // a half-written line shouldn't break the report
      }
    })
    .filter((e): e is LogEntry => !!e && Date.parse(e.ts) >= since);
  // "Messages checked" counts single-message QA runs (email, push, SMS, in-app); campaign checks are counted separately.
  const checks = entries.filter((e) => e.summary && ["check_email", "check_message", "check_campaign"].includes(e.tool));
  const campaignChecks = checks.filter((e) => e.tool === "check_campaign").length;
  const messagesChecked = checks.reduce((n, e) => n + (e.tool === "check_campaign" ? (e.messages ?? 1) : 1), 0);
  const byCheck = new Map<string, number>();
  const byTool = new Map<string, number>();
  const byWeek = new Map<string, { runs: number; fails: number }>();
  let fails = 0;
  let warns = 0;
  let blocked = 0;
  for (const e of entries) byTool.set(e.tool, (byTool.get(e.tool) ?? 0) + 1);
  for (const e of checks) {
    fails += e.summary!.fail;
    warns += e.summary!.warn;
    if (e.summary!.fail > 0) blocked++;
    for (const id of e.checkIds ?? []) byCheck.set(id, (byCheck.get(id) ?? 0) + 1);
    const d = new Date(e.ts);
    d.setUTCDate(d.getUTCDate() - d.getUTCDay());
    const week = d.toISOString().slice(0, 10);
    const w = byWeek.get(week) ?? { runs: 0, fails: 0 };
    byWeek.set(week, { runs: w.runs + 1, fails: w.fails + e.summary!.fail });
  }
  const byOperator: Record<string, { messagesChecked: number; blockingProblemsCaught: number }> = {};
  if (opts.team) {
    for (const e of checks) {
      const who = e.operator ?? "unknown";
      const o = (byOperator[who] ??= { messagesChecked: 0, blockingProblemsCaught: 0 });
      o.messagesChecked += e.tool === "check_campaign" ? (e.messages ?? 1) : 1;
      o.blockingProblemsCaught += e.summary!.fail;
    }
  }
  return {
    scope,
    period: `last ${days} days`,
    runs: entries.length,
    runsByCommand: Object.fromEntries(byTool),
    messagesChecked,
    campaignsChecked: campaignChecks,
    checksWithBlockingProblems: blocked,
    blockingProblemsCaught: fails,
    warningsRaised: warns,
    mostCommonFindings: [...byCheck.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([id, n]) => ({ id, n })),
    byWeek: [...byWeek.entries()].sort().map(([week, v]) => ({ weekStarting: week, ...v })),
    ...(opts.team ? { byOperator } : {}),
    estimatedHoursSaved: Math.round(((messagesChecked * minutesPerManualCheck) / 60) * 10) / 10,
    assumption: `${minutesPerManualCheck} minutes of manual QA per message checked (change with minutes_per_manual_check); re-checks of the same message count again, so treat this as an upper estimate.`,
  };
}

export function bulkEditPreview(snap: Snapshot, find: string, replace: string, opts: { regex?: boolean; activeOnly?: boolean } = {}) {
  if (!find) throw new Error("Nothing to find: give the text (or pattern) to look for.");
  let pattern: RegExp;
  try {
    pattern = opts.regex ? new RegExp(find, "g") : new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
  } catch (e) {
    throw new Error(`"${find}" isn't a valid pattern: ${(e as Error).message.replace(/^Invalid regular expression: /, "")}`);
  }
  if (pattern.test("")) throw new Error(`"${find}" matches empty text, so it would insert the replacement between every character.`);
  pattern.lastIndex = 0;
  // A plain-text replacement is literal: "$1" or "$&" in it must not be read as a regex back-reference.
  const replacement = opts.regex ? replace : replace.replace(/\$/g, "$$$$");
  const owner = new Map<string, { name: string; active: boolean }>();
  for (const c of snap.campaigns) for (const m of c.messageIds) owner.set(m, { name: c.name, active: isActive(c.status) });
  for (const j of snap.journeys)
    for (const s of j.steps) for (const m of s.messageIds) owner.set(m, { name: j.name, active: isActive(j.status) });

  const changes: { where: string; item: string; inside?: string; active: boolean; count: number; before: string[]; after: string[] }[] = [];
  const scan = (where: string, item: string, text: string | undefined, active: boolean, inside?: string) => {
    if (!text) return;
    const hits = [...text.matchAll(pattern)];
    if (hits.length === 0 || (opts.activeOnly && !active)) return;
    // Show readable text around each match, not raw HTML.
    const plain = (x: string) =>
      x
        .replace(/<[^>]*>/g, " ")
        .replace(/<[^>]*$|^[^<]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    const ctx = (s: string, i: number, len: number) => {
      const open = s.lastIndexOf("<", i);
      const insideTag = open > s.lastIndexOf(">", i - 1);
      if (insideTag) {
        // A match in a link or attribute: show that attribute, not the page text.
        const end = s.indexOf(">", i);
        const tag = s.slice(open, end === -1 ? i + len + 60 : end + 1);
        const attr = tag.match(/[\w-]+="[^"]*"/g)?.find((a) => a.includes(s.slice(i, i + len))) ?? tag;
        return attr.slice(0, 160);
      }
      return `…${plain(s.slice(Math.max(0, i - 60), i + len + 60))}…`;
    };
    // Each match's position in the edited text moves by what the earlier replacements added or removed.
    let shift = 0;
    const edited = text.replace(pattern, replacement);
    const after = hits.map((h) => {
      const now = h[0].replace(new RegExp(pattern.source, pattern.flags.replace("g", "")), replacement);
      const at = (h.index ?? 0) + shift;
      shift += now.length - h[0].length;
      return { at, len: now.length };
    });
    changes.push({
      where,
      item,
      inside,
      active,
      count: hits.length,
      before: hits.slice(0, 3).map((h) => ctx(text, h.index ?? 0, h[0].length)),
      after: after.slice(0, 3).map((a) => ctx(edited, a.at, a.len)),
    });
  };
  for (const m of snap.messages) {
    const o = owner.get(m.id);
    scan("subject", m.name, m.subject, o?.active ?? false, o?.name);
    scan("preheader", m.name, m.preheader, o?.active ?? false, o?.name);
    scan("body", m.name, m.body, o?.active ?? false, o?.name);
  }
  for (const b of snap.contentBlocks) scan("content block", b.name, b.body, b.usedBy.length > 0);

  return {
    find,
    replace,
    totalMatches: changes.reduce((n, c) => n + c.count, 0),
    places: changes.sort((a, b) => Number(b.active) - Number(a.active)),
    tip: changes.some((c) => c.where === "content block")
      ? "Some matches are in content blocks: editing the block once updates every message that includes it."
      : undefined,
    applying:
      "Preview only. Applying edits through the API is turned off until the adapters have been field-tested on real accounts; make the changes in the platform using this list.",
  };
}
