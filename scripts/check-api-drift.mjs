#!/usr/bin/env node
// Weekly watch for vendor API changes that could silently break the adapters.
// Prints a markdown report of what changed vs drift/baseline.json and exits 1 if anything did.
// `--write` records the current fingerprints as the new baseline (after the adapters are checked).
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const BRAZE = "https://www.braze.com/docs/assets/api/openapi/";
const SOURCES = {
  "braze:canvas-details": { url: `${BRAZE}export_canvas_get_canvas_details.yaml`, kind: "sha" },
  "braze:canvas-list": { url: `${BRAZE}export_canvas_get_canvases.yaml`, kind: "sha" },
  "braze:segment-details": { url: `${BRAZE}export_segments_get_segment_details.yaml`, kind: "sha" },
  "braze:segment-list": { url: `${BRAZE}export_segments_get_segment.yaml`, kind: "sha" },
  // Klaviyo's full spec changes constantly; a new API revision date is the signal that matters.
  "klaviyo:api-revision": { url: "https://raw.githubusercontent.com/klaviyo/openapi/main/openapi/stable.json", kind: "klaviyo-revision" },
  "iterable:mcp-server-release": { repo: "Iterable/mcp-server", kind: "gh-release" },
};

async function fingerprint(src) {
  if (src.kind === "gh-release") {
    return execFileSync("gh", ["api", `repos/${src.repo}/releases/latest`, "--jq", ".tag_name"], { encoding: "utf8" }).trim();
  }
  const res = await fetch(src.url);
  if (!res.ok) return `HTTP ${res.status}`;
  const body = await res.text();
  if (src.kind === "klaviyo-revision") return JSON.parse(body).info.version;
  return createHash("sha256").update(body).digest("hex").slice(0, 16);
}

const path = new URL("../drift/baseline.json", import.meta.url);
let baseline = {};
try { baseline = JSON.parse(readFileSync(path, "utf8")); } catch {}

const current = {};
for (const [name, src] of Object.entries(SOURCES)) current[name] = await fingerprint(src);

if (process.argv.includes("--write")) {
  writeFileSync(path, JSON.stringify(current, null, 2) + "\n");
  console.log("Baseline updated.");
  process.exit(0);
}

const changed = Object.keys(current).filter((k) => baseline[k] !== current[k]);
if (changed.length === 0) {
  console.log("No vendor API changes.");
  process.exit(0);
}
console.log("The following vendor APIs changed since the last baseline:\n");
console.log("| Source | Was | Now |\n|---|---|---|");
for (const k of changed) console.log(`| ${k} | ${baseline[k] ?? "—"} | ${current[k]} |`);
console.log("\nCheck the matching adapter against the new spec, then run `node scripts/check-api-drift.mjs --write` and commit `drift/baseline.json`.");
process.exit(1);
