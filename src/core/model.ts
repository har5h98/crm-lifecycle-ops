// The common data model every platform adapter maps into. Keep it platform-neutral:
// anything Braze-, Klaviyo- or Iterable-specific belongs in the adapter, not here.

export type Platform = "braze" | "klaviyo" | "iterable";

/** fail = will hurt customers or the brand if sent · warn = probably wrong · info = worth a look */
export type Severity = "fail" | "warn" | "info";

/**
 * How sure we are about a dependency link. "I can't see this" is a valid answer;
 * false confidence is not.
 */
export type Confidence =
  "api-verified" | "parsed-from-template" | "parsed-from-description" | "seen-on-screen" | "inferred-from-naming" | "unknown";

export interface Finding {
  /** Stable id, e.g. "links.staging-host". Users quote it in /report-problem. */
  checkId: string;
  severity: Severity;
  message: string;
  fix?: string;
  /** A short excerpt showing where the problem is. Never customer data. */
  evidence?: string;
  /** Which test persona surfaced it, for personalization findings. */
  persona?: string;
}

export interface CheckReport {
  target: string;
  platform: Platform;
  findings: Finding[];
  /** Things we deliberately did not judge (unsupported tags, live-only behaviour). */
  notVerified: string[];
  summary: Record<Severity, number>;
}

/** A synthetic test profile. Personas are made up; this tool never loads real users. */
export interface Persona {
  name: string;
  attributes: Record<string, unknown>;
}

export function summarize(findings: Finding[]): Record<Severity, number> {
  const summary: Record<Severity, number> = { fail: 0, warn: 0, info: 0 };
  for (const f of findings) summary[f.severity]++;
  return summary;
}
