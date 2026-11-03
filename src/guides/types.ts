import type { Platform } from "../core/model.js";

// Platform knowledge for /build-plan and /edit-plan: how each task is actually done in each
// platform's UI, in that platform's words, with a source for every procedure. Kept as data so it
// can be reviewed, corrected via /report-problem, and re-verified when vendors change their UI.

export const TASKS = {
  "create-campaign": "Create a one-off or scheduled campaign",
  "create-journey": "Create a multi-step journey",
  "edit-live-journey": "Change a journey that's already live",
  "edit-live-message": "Change the copy of a live or scheduled message",
  "edit-shared-content": "Change a shared content block / snippet used in live messages",
  "change-audience": "Change who a campaign or journey targets, or add exclusions",
  "link-tracking": "Add UTM parameters and click tracking",
  "frequency-and-quiet-hours": "Set frequency caps, rate limits and quiet hours",
  "conversion-tracking": "Set the conversion event / metric",
  "ab-test": "Run an A/B or multivariate test",
  "test-and-preview": "Preview as a user and send tests",
  "pause-stop-duplicate": "Pause, stop or duplicate",
} as const;

export type TaskId = keyof typeof TASKS;

export interface Procedure {
  steps: string[];
  gotchas: string[];
  /** Official documentation for this procedure. */
  docs: string[];
}

export interface PlatformGuide {
  platform: Platform;
  /** When these procedures were last checked against the vendor's docs. */
  verifiedAt: string;
  /** The platform's own words, so instructions match what the operator sees. */
  terms: { journey: string; campaign: string; segment: string; list: string; sharedContent: string; testUsers: string };
  personalization: {
    attribute: (name: string) => string;
    customAttribute: (name: string) => string;
    withFallback: (name: string, fallback: string, custom?: boolean) => string;
    conditional: (name: string) => string;
    notes: string[];
    docs: string[];
  };
  channels: Partial<Record<"email" | "push" | "sms" | "in-app", { notes: string[]; docs: string[] }>>;
  tasks: Record<TaskId, Procedure>;
  /** Things the research couldn't confirm; surfaced to users instead of guessed. */
  unverified: string[];
}
