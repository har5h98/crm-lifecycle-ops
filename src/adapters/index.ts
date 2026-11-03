import type { Platform } from "../core/model.js";
import { brazeAdapter } from "./braze.js";
import { iterableAdapter } from "./iterable.js";
import { klaviyoAdapter } from "./klaviyo.js";
import type { Adapter, AdapterOptions } from "./types.js";

export function getAdapter(platform: Platform, opts: AdapterOptions = {}): Adapter {
  switch (platform) {
    case "braze":
      return brazeAdapter(opts);
    case "klaviyo":
      return klaviyoAdapter(opts);
    case "iterable":
      return iterableAdapter(opts);
  }
}

export const ENV_VARS: Record<Platform, { required: string[]; optional: string[] }> = {
  braze: { required: ["BRAZE_API_KEY", "BRAZE_REST_ENDPOINT"], optional: ["BRAZE_WORKSPACE"] },
  klaviyo: { required: ["KLAVIYO_API_KEY"], optional: ["KLAVIYO_ACCOUNT"] },
  iterable: { required: ["ITERABLE_API_KEY"], optional: ["ITERABLE_REGION", "ITERABLE_PROJECT"] },
};

/** Which platforms have keys set, without revealing the keys. */
export function configuredPlatforms(env: Record<string, string | undefined> = process.env): Platform[] {
  return (Object.keys(ENV_VARS) as Platform[]).filter((p) => ENV_VARS[p].required.every((v) => !!env[v]));
}

export function workspaceFor(platform: Platform, env: Record<string, string | undefined> = process.env): string {
  const v = { braze: env.BRAZE_WORKSPACE, klaviyo: env.KLAVIYO_ACCOUNT, iterable: env.ITERABLE_PROJECT }[platform];
  return v ?? "default";
}
