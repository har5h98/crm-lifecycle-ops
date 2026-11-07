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

it("uses the built-in rules unless a rules file is named, and says which", async () => {
  const rules = join(dir, "..", `clo-rules-${process.pid}.json`);
  writeFileSync(rules, JSON.stringify({ severity: { "links.non-production-host": "warn" } }));
  const saved = process.env.CLO_RULES;
  delete process.env.CLO_RULES;
  try {
    const plain = await run(join(dir, "bad.html"));
    expect(plain.out).toContain("Rules: built-in defaults");
    expect(plain.code).toBe(1);
    const team = await run(join(dir, "bad.html"), "--rules", rules);
    expect(team.out).toContain(`Rules: ${rules}`);
    expect(team.code).toBe(0);
    expect((await run(join(dir, "bad.html"), "--rules", join(dir, "nope.json"))).code).toBe(2);
  } finally {
    if (saved === undefined) delete process.env.CLO_RULES;
    else process.env.CLO_RULES = saved;
  }
});

it("says when the template language was guessed", async () => {
  const r = await run(join(dir, "warn.html"));
  expect(r.out).toContain("(braze, guessed)");
  expect((await run(join(dir, "bad.html"))).out).toContain("(klaviyo)");
});

it("never shows a bare Ready when part of the email couldn't be checked", async () => {
  const f = join(dir, "..", `clo-cc-${process.pid}.html`);
  writeFileSync(
    f,
    '<html lang="en"><body>{% connected_content https://api.x.com/r :save r %}<p>{{r.title}}</p><a href="{{${set_user_to_unsubscribed_url}}}">Unsubscribe</a></body></html>',
  );
  const r = await run(f, "--platform", "braze");
  expect(r.out).toContain("Ready, except 1 part not checked");
  expect(r.out).toContain("connected_content");
  expect(r.code).toBe(0);
});
