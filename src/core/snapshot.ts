import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Confidence, Platform } from "./model.js";

// A snapshot is one point-in-time, platform-neutral copy of an account's lifecycle program.
// Adapters produce it; the dependency graph, journey checks and diffs only ever read it.

export type Status = "live" | "scheduled" | "draft" | "stopped" | "sent" | "archived";

export interface AudienceRef {
  id: string;
  kind: "segment" | "list" | "event" | "unknown";
  mode: "include" | "exclude" | "trigger";
  confidence: Confidence;
}

export interface Message {
  id: string;
  name: string;
  channel: string;
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
  return file;
}

export async function listSnapshots(platform: Platform, workspace: string): Promise<string[]> {
  try {
    const dir = dirFor(platform, workspace);
    return (await readdir(dir)).filter((f) => f.endsWith(".json")).sort().map((f) => join(dir, f));
  } catch {
    return [];
  }
}

export async function loadSnapshot(file: string): Promise<Snapshot> {
  return JSON.parse(await readFile(file, "utf8")) as Snapshot;
}

/** The newest snapshot, plus the one before it (for diffs), or the newest one taken on/before `since`. */
export async function loadLatest(platform: Platform, workspace: string, since?: string): Promise<{ latest?: Snapshot; previous?: Snapshot }> {
  const files = await listSnapshots(platform, workspace);
  if (files.length === 0) return {};
  const latest = await loadSnapshot(files[files.length - 1]!);
  let prevFile: string | undefined;
  if (since) {
    const cutoff = since.replace(/[:.]/g, "-");
    prevFile = [...files].reverse().find((f) => f.slice(f.lastIndexOf("/") + 1) <= `${cutoff}.json`);
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
      if (old.name !== x.name) changes.push({ kind, id, name: x.name, change: "renamed", detail: `was "${old.name}"`, active: activeOf(x) });
      if (statusOf && statusOf(old) !== statusOf(x)) {
        changes.push({ kind, id, name: x.name, change: "status", detail: `${statusOf(old)} → ${statusOf(x)}`, active: activeOf(x) || activeOf(old) });
      }
      const fa = fields(old);
      const fb = fields(x);
      for (const key of Object.keys(fb) as Change["change"][]) {
        if (fingerprint(fa[key]) !== fingerprint(fb[key])) changes.push({ kind, id, name: x.name, change: key, active: activeOf(x) });
      }
    }
    for (const [id, x] of A) if (!B.has(id)) changes.push({ kind, id, name: x.name, change: "removed", active: activeOf(x) });
  }

  compare("campaign", before.campaigns, after.campaigns, (c) => isActive(c.status), (c) => ({ audience: c.audience, structure: c.messageIds }), (c) => c.status);
  compare("journey", before.journeys, after.journeys, (j) => isActive(j.status), (j) => ({ audience: j.audience, structure: j.steps }), (j) => j.status);

  const ownerActive = (snap: Snapshot) => {
    const active = new Set([...snap.campaigns, ...snap.journeys].filter((x) => isActive(x.status)).map((x) => x.id));
    return (m: Message) => (m.ownerId ? active.has(m.ownerId) : false);
  };
  const activeAfter = ownerActive(after);
  compare("message", before.messages, after.messages, activeAfter, (m) => ({ content: [m.subject, m.preheader, m.from, m.body] }));
  compare("segment", before.segments, after.segments, () => false, (s) => ({ content: [s.description, s.definition] }));
  compare("content block", before.contentBlocks, after.contentBlocks, (b) => b.usedBy.length > 0, (b) => ({ content: b.body }));

  return changes.sort((x, y) => Number(y.active) - Number(x.active));
}
