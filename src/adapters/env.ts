// Credentials come only from the plugin's own settings (set at install or with /plugin configure;
// keys are kept in the system's secure storage and passed only to this server as CLO_* variables).
// People running the server in another MCP client set the same CLO_* variables in that client's config.

const NAMES = [
  "BRAZE_API_KEY",
  "BRAZE_REST_ENDPOINT",
  "BRAZE_WORKSPACE",
  "KLAVIYO_API_KEY",
  "KLAVIYO_ACCOUNT",
  "ITERABLE_API_KEY",
  "ITERABLE_REGION",
  "ITERABLE_PROJECT",
] as const;

const set = (v: string | undefined) => (v && !v.startsWith("${") ? v.trim() : undefined);

export function credentialEnv(raw: Record<string, string | undefined> = process.env): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const n of NAMES) out[n] = set(raw[`CLO_${n}`]);
  return out;
}
