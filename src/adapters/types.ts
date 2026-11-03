import type { Platform } from "../core/model.js";
import type { Snapshot } from "../core/snapshot.js";
import type { Fetcher } from "./http.js";

export interface LaunchStats {
  /** Period the numbers cover, e.g. "last 7 days". */
  period: string;
  sent: number;
  delivered?: number;
  bounces?: number;
  unsubscribes?: number;
  spamReports?: number;
  uniqueOpens?: number;
  uniqueClicks?: number;
  notes: string[];
}

export interface Adapter {
  platform: Platform;
  /** A label for the account/workspace, used to keep snapshots apart. Never a secret. */
  workspace: string;
  /** Cheapest possible authenticated call. Resolves with a short description, throws on failure. */
  ping(): Promise<string>;
  /** Pull everything into a snapshot. `previous` lets adapters skip re-fetching unchanged items. */
  snapshot(previous?: Snapshot): Promise<Snapshot>;
  launchStats(kind: "campaign" | "journey", id: string): Promise<LaunchStats>;
}

export interface AdapterOptions {
  fetcher?: Fetcher;
  env?: Record<string, string | undefined>;
}

export function missingEnv(platform: Platform, names: string[]): Error {
  return new Error(
    `${platform} isn't connected. Run /plugin configure crm-lifecycle-ops and fill in the ${platform} fields (see /connect); keys go to your system's secure storage.`,
  );
}
