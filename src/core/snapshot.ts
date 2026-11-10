import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { Confidence, Platform } from "./model.js";

// A snapshot is one point-in-time, platform-neutral copy of an account's lifecycle program.
// Adapters produce it; the dependency graph, journey checks and diffs only ever read it.

export type Status = "live" | "scheduled" | "draft" | "stopped" | "sent" | "archived";

export interface AudienceRef {
  id: string;
  kind: "segment" | "list" | "event" | "unknown";
  mode: "include" | "exclude" | "trigger";
  confidence: Confidence;
  /** Human name when the id is opaque (e.g. a Klaviyo metric id for "Placed Order"). */
  name?: string;
  /** When a seen-on-screen fact was recorded. */
  seenAt?: string;
}

export type Channel = "email" | "push" | "sms" | "in-app" | "content-card" | "webhook" | "other";

/** Map each platform's channel names (ios_push, send-sms, InApp…) onto one vocabulary. */
export function normalizeChannel(raw: string | undefined): Channel {
  const c = (raw ?? "").toLowerCase().replace(/[\s_-]+/g, "");
  if (c.includes("email")) return "email";
  if (c.includes("push")) return "push";
  if (c.includes("sms") || c.includes("mms") || c.includes("text")) return "sms";
  if (c.includes("inapp")) return "in-app";
  if (c.includes("contentcard")) return "content-card";
  if (c.includes("webhook")) return "webhook";
  return "other";
}

export interface Button {
  text: string;
  link?: string;
}

export interface Message {
  id: string;
  name: string;
  /** Normalized channel; the platform's own name is kept in `platformChannel`. */
  channel: Channel | string;
  platformChannel?: string;
  /** Push / in-app / content-card title or header. */
  title?: string;
  /** Push / in-app / SMS tap-through destination (deep link or URL). */
  deepLink?: string;
  imageUrl?: string;
  buttons?: Button[];
  /** SMS: true when the platform will append the account's opt-out text to this message. */
  optOutAppended?: boolean;
  /** Receipts, password resets…: exempt from unsubscribe requirements. */
  transactional?: boolean;
  /** Webhooks: where the request goes and how. */
  webhookUrl?: string;
  webhookMethod?: string;
  /** The campaign or journey this message belongs to (absent for standalone templates). */
  ownerId?: string;
  subject?: string;
  preheader?: string;
  from?: string;
  body: string;
}

export interface Campaign {
  id: string;
  name: string;
  status: Status;
  channels: string[];
  messageIds: string[];
  audience: AudienceRef[];
  conversionEvents?: string[];
  tags?: string[];
  updatedAt?: string;
}

export interface JourneyStep {
  id: string;
  name: string;
  type: string;
  messageIds: string[];
  next: string[];
}

export interface Journey {
  id: string;
  name: string;
  status: Status;
  entryStepIds: string[];
  steps: JourneyStep[];
  /** False when the platform API doesn't expose the step graph (e.g. Iterable). */
  stepsKnown: boolean;
  audience: AudienceRef[];
  conversionEvents?: string[];
  tags?: string[];
  updatedAt?: string;
}

export interface Segment {
  id: string;
  name: string;
  kind: "segment" | "list";
  /** Human-readable filter description, when that's all the platform gives (Braze). */
  description?: string;
  /** Structured definition, when the platform gives one (Klaviyo). */
  definition?: unknown;
  updatedAt?: string;
}

export interface ContentBlock {
  id: string;
  name: string;
  body: string;
  /** Message ids the platform says include this block. */
  usedBy: string[];
  updatedAt?: string;
}

export interface Snapshot {
  platform: Platform;
  workspace: string;
  takenAt: string;
  demo?: boolean;
  campaigns: Campaign[];
  journeys: Journey[];
  messages: Message[];
  segments: Segment[];
  contentBlocks: ContentBlock[];
  /** What the adapter could not fetch or map, said plainly. */
  gaps: string[];
}

export function isActive(status: Status): boolean {
  return status === "live" || status === "scheduled";
}

// ---------- storage: ~/.crm-lifecycle-ops/snapshots/<platform>-<workspace>/<timestamp>.json ----------

export function homeDir(): string {
  return process.env.CLO_HOME ?? join(homedir(), ".crm-lifecycle-ops");
}

function dirFor(platform: Platform, workspace: string): string {
  return join(homeDir(), "snapshots", `${platform}-${workspace.replace(/[^\w-]/g, "_")}`);
}

export async function saveSnapshot(s: Snapshot): Promise<string> {
  const dir = dirFor(s.platform, s.workspace);
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${s.takenAt.replace(/[:.]/g, "-")}.json`);
  await writeFile(file, JSON.stringify(s));
  // Keep the newest snapshots only; a daily refresh would otherwise grow without limit.
  const keep = Number(process.env.CLO_KEEP_SNAPSHOTS ?? 30);
  const all = (await readdir(dir)).filter((f) => f.endsWith(".json")).sort();
  await Promise.all(all.slice(0, Math.max(0, all.length - keep)).map((f) => rm(join(dir, f), { force: true })));
  return file;
}

export async function listSnapshots(platform: Platform, workspace: string): Promise<string[]> {
  try {
    const dir = dirFor(platform, workspace);
    return (await readdir(dir))
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => join(dir, f));
  } catch {
    return [];
  }
}

/** Overwrite the newest snapshot in place (used to record facts read from the dashboard). */
export async function updateLatest(s: Snapshot): Promise<string | undefined> {
  const files = await listSnapshots(s.platform, s.workspace);
  const file = files[files.length - 1];
  if (file) await writeFile(file, JSON.stringify(s));
  return file;
}

/** Carry dashboard-recorded audiences forward when the API still can't see them. */
export function carryForwardSeenAudiences(prev: Snapshot | undefined, next: Snapshot): void {
  if (!prev) return;
  const seen = new Map<string, AudienceRef[]>();
  for (const x of [...prev.campaigns, ...prev.journeys]) {
    const refs = x.audience.filter((a) => a.confidence === "seen-on-screen");
    if (refs.length) seen.set(x.id, refs);
  }
  for (const x of [...next.campaigns, ...next.journeys]) {
    const refs = seen.get(x.id);
    if (refs && x.audience.every((a) => a.confidence === "unknown")) x.audience = refs;
  }
}

export async function loadSnapshot(file: string): Promise<Snapshot> {
  return JSON.parse(await readFile(file, "utf8")) as Snapshot;
}

/** The newest snapshot, plus the one before it (for diffs), or the newest one taken on/before `since`. */
export async function loadLatest(
  platform: Platform,
  workspace: string,
  since?: string,
): Promise<{ latest?: Snapshot; previous?: Snapshot }> {
  const files = await listSnapshots(platform, workspace);
  if (files.length === 0) return {};
  const latest = await loadSnapshot(files[files.length - 1]!);
  let prevFile: string | undefined;
  if (since) {
    const cutoff = since.replace(/[:.]/g, "-");
    prevFile = [...files].reverse().find((f) => basename(f) <= `${cutoff}.json`);
  } else {
    prevFile = files[files.length - 2];
  }
  return { latest, previous: prevFile ? await loadSnapshot(prevFile) : undefined };
}

// ---------- diff ----------

export interface Change {
  kind: "campaign" | "journey" | "message" | "segment" | "content block";
  id: string;
  name: string;
  change: "added" | "removed" | "status" | "content" | "audience" | "structure" | "renamed";
  detail?: string;
  /** True when the thing is live/scheduled now (or was, if removed). */
  active: boolean;
}

const fingerprint = (v: unknown) => JSON.stringify(v);

export function diffSnapshots(before: Snapshot, after: Snapshot): Change[] {
  const changes: Change[] = [];

  const byId = <T extends { id: string }>(xs: T[]) => new Map(xs.map((x) => [x.id, x]));
  function compare<T extends { id: string; name: string }>(
    kind: Change["kind"],
    a: T[],
    b: T[],
    activeOf: (x: T) => boolean,
    fields: (x: T) => Partial<Record<Change["change"], unknown>>,
    statusOf?: (x: T) => string,
  ): void {
    const A = byId(a);
    const B = byId(b);
    for (const [id, x] of B) {
      const old = A.get(id);
      if (!old) {
        changes.push({ kind, id, name: x.name, change: "added", active: activeOf(x) });
        continue;
      }
      if (old.name !== x.name)
        changes.push({ kind, id, name: x.name, change: "renamed", detail: `was "${old.name}"`, active: activeOf(x) });
      if (statusOf && statusOf(old) !== statusOf(x)) {
        changes.push({
          kind,
          id,
          name: x.name,
          change: "status",
          detail: `${statusOf(old)} → ${statusOf(x)}`,
          active: activeOf(x) || activeOf(old),
        });
      }
      const fa = fields(old);
      const fb = fields(x);
      for (const key of Object.keys(fb) as Change["change"][]) {
        if (fingerprint(fa[key]) !== fingerprint(fb[key])) changes.push({ kind, id, name: x.name, change: key, active: activeOf(x) });
      }
    }
    for (const [id, x] of A) if (!B.has(id)) changes.push({ kind, id, name: x.name, change: "removed", active: activeOf(x) });
  }

  compare(
    "campaign",
    before.campaigns,
    after.campaigns,
    (c) => isActive(c.status),
    (c) => ({ audience: c.audience, structure: c.messageIds }),
    (c) => c.status,
  );
  compare(
    "journey",
    before.journeys,
    after.journeys,
    (j) => isActive(j.status),
    (j) => ({ audience: j.audience, structure: j.steps }),
    (j) => j.status,
  );

  const ownerActive = (snap: Snapshot) => {
    const active = new Set([...snap.campaigns, ...snap.journeys].filter((x) => isActive(x.status)).map((x) => x.id));
    return (m: Message) => (m.ownerId ? active.has(m.ownerId) : false);
  };
  const activeAfter = ownerActive(after);
  compare("message", before.messages, after.messages, activeAfter, (m) => ({ content: [m.subject, m.preheader, m.from, m.body] }));
  compare(
    "segment",
    before.segments,
    after.segments,
    () => false,
    (s) => ({ content: [s.description, s.definition] }),
  );
  compare(
    "content block",
    before.contentBlocks,
    after.contentBlocks,
    (b) => b.usedBy.length > 0,
    (b) => ({ content: b.body }),
  );

  return changes.sort((x, y) => Number(y.active) - Number(x.active));
}
