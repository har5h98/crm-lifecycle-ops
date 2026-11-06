import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectPlatform, runCheckCli } from "../src/cli/check.js";

const dir = mkdtempSync(join(tmpdir(), "clo-cli-"));
writeFileSync(join(dir, "bad.html"), '<p>Hi</p><a href="https://staging.fernbrook.com/x">Shop</a>{% unsubscribe %}');
writeFileSync(
  join(dir, "warn.html"),
  '<html lang="en"><div style="display:none">Ends Sunday</div><table role="presentation"><tr><td><a href="https://x.com">Click here</a> <a href="https://x.com/u">Unsubscribe</a></td></tr></table></html>',
);
const run = async (...argv: string[]) => {
  let out = "";
  const code = await runCheckCli(argv, (s) => (out += s));
  return { code, out };
};

describe("crm-lifecycle-ops check", () => {
  it("exits 1 on a blocking problem and names it", async () => {
    const r = await run(join(dir, "bad.html"));
    expect(r.code).toBe(1);
    expect(r.out).toContain("links.non-production-host");
  });
  it("passes warnings by default and fails them with --fail-on warn", async () => {
    expect((await run(join(dir, "warn.html"))).code).toBe(0);
    expect((await run(join(dir, "warn.html"), "--fail-on", "warn")).code).toBe(1);
  });
  it("checks every .html file in a folder, with JSON output", async () => {
    const r = await run(dir, "--json");
    const parsed = JSON.parse(r.out);
    expect(parsed.files).toHaveLength(2);
    expect(parsed.passed).toBe(false);
  });
  it("rejects unknown options with exit code 2", async () => {
    expect((await run("--nope")).code).toBe(2);
  });
  it("detects each platform's template language", () => {
    expect(detectPlatform("Hi {{${first_name}}}")).toBe("braze");
    expect(detectPlatform("Hi {{ person.first_name|default:'there' }}")).toBe("klaviyo");
    expect(detectPlatform('Hi {{defaultIfEmpty firstName "there"}}')).toBe("iterable");
  });
});

it("--demo checks the bundled sample emails and finds their planted problems", async () => {
  const r = await run("--demo", "--json");
  const files = JSON.parse(r.out).files as { file: string; findings: { checkId: string }[] }[];
  const by = (name: string) => files.find((f) => f.file.endsWith(name))!.findings.map((f) => f.checkId);
  expect(files).toHaveLength(4);
  expect(by("order-shipped.html").filter((id) => !id.startsWith("html.no-preheader"))).toEqual([]);
  expect(by("price-drop-alert.html")).toContain("links.non-production-host");
  expect(by("welcome.html")).toContain("personalization.dangling-punctuation");
  expect(by("weekly-picks.html")).toEqual(expect.arrayContaining(["copy.preheader-boilerplate", "a11y.vague-link-text"]));
  expect(r.code).toBe(1);
});
