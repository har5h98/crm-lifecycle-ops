#!/usr/bin/env node
// End-to-end smoke test of the BUILT server (dist/), the way Claude runs it: spawn over stdio,
// list tools, and call the main ones against the demo account. Catches bundling breakage that
// unit tests on src/ can't see. Run after `npm run build`.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const home = mkdtempSync(join(tmpdir(), "clo-smoke-"));
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/mcp-server.js"],
  env: { ...process.env, CLO_HOME: home },
});
const client = new Client({ name: "smoke", version: "1" });
await client.connect(transport);

const fail = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};
const call = async (name, args) => {
  const res = await client.callTool({ name, arguments: args });
  if (res.isError) fail(`${name} returned an error: ${res.content?.[0]?.text}`);
  return JSON.parse(res.content[0].text);
};

const { tools } = await client.listTools();
if (tools.length < 20) fail(`expected at least 20 tools, got ${tools.length}`);
const unannotated = tools.filter((t) => t.annotations?.readOnlyHint === undefined || !t.title).map((t) => t.name);
if (unannotated.length) fail(`tools without annotations: ${unannotated.join(", ")}`);
console.log(`✓ ${tools.length} tools, all annotated`);

const checks = await call("list_checks", {});
if (!checks.checks?.length || checks.version === "unknown") fail("list_checks: no checks or no version");
console.log(`✓ list_checks: ${checks.checks.length} checks, v${checks.version}`);

// First run with nothing connected: a Klaviyo question must point at /connect or the Braze demo,
// not at a demo refresh that only works for Braze.
const cold = await client.callTool({ name: "what_breaks", arguments: { platform: "klaviyo", kind: "attribute", value: "x" } });
if (!cold.isError || !/connect/.test(cold.content[0].text) || !/platform braze/.test(cold.content[0].text))
  fail(`cold start (klaviyo): unhelpful message: ${cold.content?.[0]?.text}`);
console.log("✓ cold start points to /connect or the Braze demo");

const refresh = await call("refresh_account", { platform: "braze", demo: true });
if (!refresh.counts?.campaigns) fail("refresh_account demo: no campaigns");
console.log("✓ refresh_account (demo)");

const impact = await call("what_breaks", { platform: "braze", kind: "attribute", value: "loyalty_tier" });
if (!impact.dependents?.length) fail("what_breaks: no dependents");
console.log("✓ what_breaks");

const campaign = await call("check_campaign", { platform: "braze", name_or_id: "Flash Sale Text" });
if (!campaign.messages?.[0]?.findings?.some((f) => f.checkId === "sms.unicode")) fail("check_campaign: expected sms.unicode");
console.log("✓ check_campaign (SMS)");

const email = await call("check_email", { platform: "braze", html: "<p>Hi {{${first_name}}},</p>" });
if (!email.findings.some((f) => f.checkId === "links.no-unsubscribe")) fail("check_email: expected links.no-unsubscribe");
console.log("✓ check_email");

const plan = await call("how_to", { platform: "klaviyo", task: "edit-live-journey" });
if (!plan.steps?.length) fail("how_to: no steps");
console.log("✓ how_to");

const signOff = await call("check_campaign", { platform: "braze", name_or_id: "Price Drop Alert", sign_off_report: true });
if (!signOff.signOffReport?.markdown?.includes("QA sign-off")) fail("check_campaign: no sign-off report");
console.log("✓ check_campaign sign-off report");

await client.close();

// The same bundle doubles as a CLI for CI: a blocking problem must exit 1.
const { spawnSync } = await import("node:child_process");
const { writeFileSync } = await import("node:fs");
const bad = join(home, "bad.html");
writeFileSync(bad, '<a href="https://staging.example.com/x">Shop</a> unsubscribe');
const cli = spawnSync(process.execPath, ["dist/mcp-server.js", "check", bad], {
  encoding: "utf8",
  env: { ...process.env, CLO_HOME: home },
});
if (cli.status !== 1 || !cli.stdout.includes("links.non-production-host"))
  fail(`CLI check: exit ${cli.status}, output: ${cli.stdout}${cli.stderr}`);
console.log("✓ CLI check exits 1 on a blocking problem");

// The README's 30-second try must work from any folder, using the samples shipped in the package.
const demo = spawnSync(process.execPath, [join(process.cwd(), "dist/mcp-server.js"), "check", "--demo"], { encoding: "utf8", cwd: home });
if (demo.status !== 1 || !demo.stdout.includes("price-drop-alert.html"))
  fail(`check --demo: exit ${demo.status}, output: ${demo.stdout}${demo.stderr}`);
console.log("✓ check --demo works from any folder");
console.log("Smoke test passed.");
