import { referencedVariables } from "../checks/personalization.js";
import type { Confidence } from "./model.js";
import { isActive, type AudienceRef, type Snapshot, type Status } from "./snapshot.js";

// The dependency map behind /what-breaks and /plan-journey. Every link carries how we know it,
// and anything we can't see is listed as unknown instead of silently left out.

export type TargetKind = "attribute" | "segment" | "list" | "content-block" | "event" | "message" | "text";

export interface Dependent {
  kind: "campaign" | "journey" | "segment" | "message" | "content block";
  id: string;
  name: string;
  status: Status | "n/a";
  active: boolean;
  via: string;
  confidence: Confidence;
}

export interface ImpactReport {
  target: { kind: TargetKind; value: string; resolvedName?: string };
  dependents: Dependent[];
  /** Live things we can't rule in or out. */
  unknown: { kind: "campaign" | "journey"; id: string; name: string }[];
  /** Why those can't be ruled out, and what to do about it (said once, not per item). */
  unknownWhy?: string;
  summary: { activeAffected: number; inactiveAffected: number; unknownActive: number };
}

const norm = (s: string) => s.trim().toLowerCase();

function owners(snap: Snapshot) {
  const map = new Map<string, { kind: "campaign" | "journey"; id: string; name: string; status: Status }>();
  for (const c of snap.campaigns) for (const m of c.messageIds) map.set(m, { kind: "campaign", id: c.id, name: c.name, status: c.status });
  for (const j of snap.journeys)
    for (const s of j.steps) for (const m of s.messageIds) map.set(m, { kind: "journey", id: j.id, name: j.name, status: j.status });
  return map;
}

function resolveSegment(snap: Snapshot, value: string) {
  const v = norm(value);
  return (
    snap.segments.find((s) => norm(s.id) === v) ??
    snap.segments.find((s) => norm(s.name) === v) ??
    snap.segments.find((s) => norm(s.name).includes(v))
  );
}

export function whatBreaks(snap: Snapshot, kind: TargetKind, value: string): ImpactReport {
  const out = new Map<string, Dependent>();
  const add = (d: Dependent) => {
    const key = `${d.kind}:${d.id}`;
    const existing = out.get(key);
    const rank: Record<Confidence, number> = {
      "api-verified": 0,
      "seen-on-screen": 1,
      "parsed-from-template": 2,
      "parsed-from-description": 3,
      "inferred-from-naming": 4,
      unknown: 5,
    };
    if (!existing || rank[d.confidence] < rank[existing.confidence]) out.set(key, d);
  };
  const ownerOf = owners(snap);
  const target: ImpactReport["target"] = { kind, value };

  const addMessageOwners = (messageId: string, via: string, confidence: Confidence) => {
    const o = ownerOf.get(messageId);
    const m = snap.messages.find((x) => x.id === messageId);
    if (o)
      add({
        kind: o.kind,
        id: o.id,
        name: o.name,
        status: o.status,
        active: isActive(o.status),
        via: m ? `${via} in "${m.name}"` : via,
        confidence,
      });
  };
  const addAudienceUsers = (ids: Set<string>, via: string, confidence: Confidence) => {
    for (const x of [
      ...snap.campaigns.map((c) => ({ ...c, k: "campaign" as const })),
      ...snap.journeys.map((j) => ({ ...j, k: "journey" as const })),
    ]) {
      const ref = x.audience.find((a: AudienceRef) => ids.has(a.id));
      if (ref)
        add({
          kind: x.k,
          id: x.id,
          name: x.name,
          status: x.status,
          active: isActive(x.status),
          via: `${ref.mode === "exclude" ? "excludes" : ref.mode === "trigger" ? "is triggered by" : "targets"} ${via}`,
          confidence: ref.confidence === "api-verified" ? confidence : ref.confidence,
        });
    }
  };

  if (kind === "attribute") {
    const attr = norm(value);
    const matches = (v: string) => {
      const n = norm(v);
      return n === attr || n.endsWith(`.${attr}`);
    };
    for (const m of snap.messages) {
      if (referencedVariables(`${m.subject ?? ""} ${m.body}`, snap.platform).some(matches))
        addMessageOwners(m.id, `uses {{${value}}}`, "parsed-from-template");
    }
    for (const b of snap.contentBlocks) {
      if (referencedVariables(b.body, snap.platform).some(matches)) {
        add({
          kind: "content block",
          id: b.id,
          name: b.name,
          status: "n/a",
          active: b.usedBy.length > 0,
          via: `uses {{${value}}}`,
          confidence: "parsed-from-template",
        });
        for (const mid of b.usedBy) addMessageOwners(mid, `includes block "${b.name}"`, "api-verified");
      }
    }
    const segIds = new Set<string>();
    for (const s of snap.segments) {
      if (s.definition && JSON.stringify(s.definition).toLowerCase().includes(attr)) {
        segIds.add(s.id);
        add({ kind: "segment", id: s.id, name: s.name, status: "n/a", active: false, via: "filters on it", confidence: "api-verified" });
      } else if (s.description && s.description.toLowerCase().includes(attr)) {
        segIds.add(s.id);
        add({
          kind: "segment",
          id: s.id,
          name: s.name,
          status: "n/a",
          active: false,
          via: "filter description mentions it",
          confidence: "parsed-from-description",
        });
      }
    }
    addAudienceUsers(segIds, "a segment that filters on it", "api-verified");
  }

  if (kind === "segment" || kind === "list") {
    const seg = resolveSegment(snap, value);
    target.resolvedName = seg?.name;
    const ids = new Set([seg?.id ?? value]);
    addAudienceUsers(ids, `"${seg?.name ?? value}"`, "api-verified");
    for (const s of snap.segments) {
      if (seg && s.id !== seg.id && s.definition && JSON.stringify(s.definition).includes(seg.id)) {
        add({
          kind: "segment",
          id: s.id,
          name: s.name,
          status: "n/a",
          active: false,
          via: `is built on "${seg.name}"`,
          confidence: "api-verified",
        });
        addAudienceUsers(new Set([s.id]), `"${s.name}" (built on "${seg.name}")`, "api-verified");
      }
    }
  }

  if (kind === "content-block") {
    const v = norm(value);
    const block = snap.contentBlocks.find((b) => norm(b.id) === v || norm(b.name) === v);
    target.resolvedName = block?.name;
    const name = block?.name ?? value;
    for (const mid of block?.usedBy ?? []) addMessageOwners(mid, `includes block "${name}"`, "api-verified");
    const ref = new RegExp(`content_blocks\\.\\$\\{\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\}`, "i");
    for (const m of snap.messages) if (ref.test(m.body)) addMessageOwners(m.id, `includes block "${name}"`, "parsed-from-template");
  }

  if (kind === "event") {
    const v = norm(value);
    for (const x of [
      ...snap.campaigns.map((c) => ({ ...c, k: "campaign" as const })),
      ...snap.journeys.map((j) => ({ ...j, k: "journey" as const })),
    ]) {
      if (x.audience.some((a) => a.kind === "event" && (norm(a.id) === v || norm(a.name ?? "") === v)))
        add({
          kind: x.k,
          id: x.id,
          name: x.name,
          status: x.status,
          active: isActive(x.status),
          via: "is triggered by it",
          confidence: "api-verified",
        });
      if (x.conversionEvents?.some((e) => norm(e) === v))
        add({
          kind: x.k,
          id: x.id,
          name: x.name,
          status: x.status,
          active: isActive(x.status),
          via: "counts it as a conversion",
          confidence: "api-verified",
        });
    }
    for (const m of snap.messages)
      if (m.body.toLowerCase().includes(v)) addMessageOwners(m.id, "mentions it in the template", "parsed-from-template");
  }

  if (kind === "message") {
    const v = norm(value);
    const m = snap.messages.find((x) => norm(x.id) === v || norm(x.name) === v);
    target.resolvedName = m?.name;
    if (m) addMessageOwners(m.id, "sends it", "api-verified");
  }

  if (kind === "text") {
    const v = value.toLowerCase();
    for (const m of snap.messages)
      if (`${m.subject ?? ""} ${m.preheader ?? ""} ${m.body}`.toLowerCase().includes(v))
        addMessageOwners(m.id, `contains "${value}"`, "parsed-from-template");
    for (const b of snap.contentBlocks) {
      if (b.body.toLowerCase().includes(v)) {
        add({
          kind: "content block",
          id: b.id,
          name: b.name,
          status: "n/a",
          active: b.usedBy.length > 0,
          via: `contains "${value}"`,
          confidence: "parsed-from-template",
        });
        for (const mid of b.usedBy) addMessageOwners(mid, `includes block "${b.name}"`, "api-verified");
      }
    }
  }

  // Audience-based questions can't be answered for live items whose targeting we can't see.
  const unknown: ImpactReport["unknown"] = [];
  if (kind === "segment" || kind === "list" || kind === "attribute" || kind === "event") {
    for (const x of [
      ...snap.campaigns.map((c) => ({ ...c, k: "campaign" as const })),
      ...snap.journeys.map((j) => ({ ...j, k: "journey" as const })),
    ]) {
      if (isActive(x.status) && x.audience.some((a) => a.confidence === "unknown") && !out.has(`${x.k}:${x.id}`)) {
        unknown.push({ kind: x.k, id: x.id, name: x.name });
      }
    }
  }

  const unknownWhy = unknown.length
    ? `${snap.platform === "braze" ? "Braze's API" : "The platform's API"} doesn't say ${kind === "event" ? "what triggers these" : "which segments these target"}. Open each one's ${kind === "event" ? "entry/trigger" : "audience"} step to check, or record what you see with record_audience.`
    : undefined;
  const dependents = [...out.values()].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
  return {
    target,
    dependents,
    unknown,
    unknownWhy,
    summary: {
      activeAffected: dependents.filter((d) => d.active && (d.kind === "campaign" || d.kind === "journey")).length,
      inactiveAffected: dependents.filter((d) => !d.active && (d.kind === "campaign" || d.kind === "journey")).length,
      unknownActive: unknown.length,
    },
  };
}

/** For /plan-journey: what's already live that touches the same audience, trigger or data. */
export function findOverlaps(snap: Snapshot, plan: { segments?: string[]; lists?: string[]; events?: string[]; attributes?: string[] }) {
  const reports = [
    ...(plan.segments ?? []).map((s) => whatBreaks(snap, "segment", s)),
    ...(plan.lists ?? []).map((s) => whatBreaks(snap, "list", s)),
    ...(plan.events ?? []).map((e) => whatBreaks(snap, "event", e)),
    ...(plan.attributes ?? []).map((a) => whatBreaks(snap, "attribute", a)),
  ];
  const live = new Map<string, Dependent & { overlapsOn: string[] }>();
  const unknown = new Map<string, ImpactReport["unknown"][number]>();
  let unknownWhy: string | undefined;
  for (const r of reports) {
    const label = r.target.resolvedName ?? r.target.value;
    for (const d of r.dependents.filter((x) => x.active && (x.kind === "campaign" || x.kind === "journey"))) {
      const key = `${d.kind}:${d.id}`;
      const prev = live.get(key);
      live.set(key, { ...d, overlapsOn: [...(prev?.overlapsOn ?? []), `${r.target.kind} "${label}" (${d.via})`] });
    }
    for (const u of r.unknown) unknown.set(`${u.kind}:${u.id}`, u);
    unknownWhy ??= r.unknownWhy;
  }
  const rest = [...unknown.values()].filter((u) => !live.has(`${u.kind}:${u.id}`));
  return { liveOverlaps: [...live.values()], unknown: rest, unknownWhy: rest.length ? unknownWhy : undefined };
}
