import type { Finding } from "./model.js";
import type { Journey, Snapshot } from "./snapshot.js";

const BRANCH = /split|path|branch|conditional|decision|experiment|audience/i;

/** Structural checks on a journey's step graph: dead ends, orphans, empty steps, broken links. */
export function checkJourneyStructure(j: Journey): { findings: Finding[]; notVerified: string[] } {
  const findings: Finding[] = [];
  if (!j.stepsKnown) {
    return {
      findings,
      notVerified: [`The step order of "${j.name}" isn't available from the API, so dead ends and unreachable steps weren't checked.`],
    };
  }
  if (j.steps.length === 0) {
    findings.push({ checkId: "journey.empty", severity: "fail", message: `"${j.name}" has no steps.` });
    return { findings, notVerified: [] };
  }
  const byId = new Map(j.steps.map((s) => [s.id, s]));

  for (const s of j.steps) {
    for (const n of s.next) {
      if (!byId.has(n))
        findings.push({
          checkId: "journey.broken-link",
          severity: "warn",
          message: `Step "${s.name}" points to a step that doesn't exist (${n}).`,
        });
    }
    if (BRANCH.test(s.type) && s.next.length === 0) {
      findings.push({
        checkId: "journey.dead-end-branch",
        severity: "warn",
        message: `Branch step "${s.name}" leads nowhere; people who reach it exit silently.`,
        fix: "Connect each path to a next step, or add an explicit exit.",
      });
    }
    if (/message|email|send/i.test(s.type) && s.messageIds.length === 0) {
      findings.push({
        checkId: "journey.empty-message-step",
        severity: "warn",
        message: `Message step "${s.name}" has no message attached.`,
      });
    }
  }

  const entries = j.entryStepIds.filter((id) => byId.has(id));
  if (entries.length === 0) {
    findings.push({ checkId: "journey.no-entry", severity: "warn", message: `"${j.name}" has no identifiable first step.` });
  } else {
    const seen = new Set<string>();
    const queue = [...entries];
    while (queue.length) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      queue.push(...(byId.get(id)?.next ?? []));
    }
    const orphans = j.steps.filter((s) => !seen.has(s.id));
    if (orphans.length) {
      findings.push({
        checkId: "journey.unreachable-steps",
        severity: "warn",
        message: `${orphans.length} step(s) can never be reached: ${orphans
          .map((s) => `"${s.name}"`)
          .slice(0, 5)
          .join(", ")}.`,
      });
    }
  }
  return { findings, notVerified: [] };
}

/** A Mermaid flowchart of a journey, labelled with each message's subject line. */
export function journeyDiagram(j: Journey, snap: Snapshot): string {
  const subject = new Map(snap.messages.map((m) => [m.id, m.subject]));
  // Show personalization as [field] rather than raw template code.
  const readable = (s: string) =>
    s.replace(/\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}/g, (tag) => {
      const field =
        tag
          .replace(/\$\{|\}|\{|%/g, " ")
          .replace(/\|[\s\S]*/, "")
          .trim()
          .split(/\s+/)
          .pop() ?? "";
      return `[${field.split(".").pop()}]`;
    });
  const safe = (s: string) =>
    readable(s)
      .replace(/["{}()<>|#]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60);
  const ids = new Map(j.steps.map((s, i) => [s.id, `s${i}`]));
  const lines = ["flowchart TD", `  start(("${safe(j.name)}"))`];
  for (const s of j.steps) {
    const subj = s.messageIds.map((m) => subject.get(m)).find(Boolean);
    const label = `${safe(s.name || s.type)}${subj ? `<br/><i>${safe(subj)}</i>` : ""}`;
    lines.push(BRANCH.test(s.type) ? `  ${ids.get(s.id)}{"${label}"}` : `  ${ids.get(s.id)}["${label}"]`);
  }
  for (const e of j.entryStepIds) if (ids.has(e)) lines.push(`  start --> ${ids.get(e)}`);
  if (!j.stepsKnown) for (const s of j.steps) lines.push(`  start -.-> ${ids.get(s.id)}`);
  for (const s of j.steps) for (const n of s.next) if (ids.has(n)) lines.push(`  ${ids.get(s.id)} --> ${ids.get(n)}`);
  return lines.join("\n");
}
