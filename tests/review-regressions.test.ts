import { afterEach, describe, expect, it, vi } from "vitest";
import { checkChannelMessage } from "../src/checks/channels.js";
import { checkEmail } from "../src/checks/email.js";
import { checkHouseRules } from "../src/checks/house.js";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brazeEndpoint } from "../src/adapters/braze.js";
import { parseCsv } from "../src/adapters/iterable.js";
import { expandContentBlocks } from "../src/checks/campaign.js";
import { checkLinksLive, isNonProdHost, looksNonProdHost } from "../src/checks/links.js";
import { checkPersonalization } from "../src/checks/personalization.js";
import { runCheckCli } from "../src/cli/check.js";
import { whatBreaks } from "../src/core/graph.js";
import { bulkEditPreview } from "../src/core/ops.js";
import { loadRules, RulebookSchema } from "../src/core/rules.js";
import type { Snapshot } from "../src/core/snapshot.js";
import { demoSnapshot } from "../src/demo/fernbrook.js";

// Each case here is a false alarm or a miss found in an independent review (2026-11-02).
const ids = (r: { findings: { checkId: string }[] }) => r.findings.map((f) => f.checkId);
const UNSUB = { iterable: '<a href="{{unsubscribeUrl}}">u</a>', klaviyo: '<a href="{% unsubscribe_url %}">u</a>' };

describe("valid templates don't fail", () => {
  it("Iterable block and nested helpers", async () => {
    const r = await checkEmail({
      platform: "iterable",
      html: `<p>{{#ifEq (defaultIfEmpty tier "") "Gold"}}Gold{{else}}Member{{/ifEq}} {{capitalize firstName}} {{dateFormat signupDate format="yyyy"}}</p>${UNSUB.iterable}`,
    });
    expect(ids(r).filter((i) => i.startsWith("personalization.") && i !== "personalization.dangling-punctuation")).toEqual([]);
    expect(r.variables).toEqual(["firstName", "signupDate", "tier"]);
  });
  it("flags an unguarded Iterable comparison as a warning, not a failure", async () => {
    const r = await checkEmail({ platform: "iterable", html: `<p>{{#ifEq tier "Gold"}}G{{/ifEq}}</p>${UNSUB.iterable}` });
    expect(ids(r)).toContain("personalization.iterable-empty-comparison");
    expect(r.summary.fail).toBe(0);
  });
  it("Klaviyo coupon, today, catalog and elif", async () => {
    const r = await checkEmail({
      platform: "klaviyo",
      html: `<p>Code {% coupon_code 'WELCOME' %} on {% today '%b %d' %}</p>{% catalog event.SKU %}{{ catalog_item.title }}{% endcatalog %}{% if a %}x{% elif b %}y{% endif %}${UNSUB.klaviyo}`,
    });
    expect(r.summary.fail).toBe(0);
    expect(r.notVerified.join(" ")).toMatch(/coupon/i);
  });
  it("unknown platform tags are 'not verified', not syntax errors", async () => {
    const r = await checkEmail({ platform: "klaviyo", html: `<p>{% some_new_tag 'x' %} hi</p>${UNSUB.klaviyo}` });
    expect(ids(r)).not.toContain("personalization.syntax-error");
  });
});

describe("links", () => {
  it("transactional email doesn't need an unsubscribe", async () => {
    const r = await checkEmail({ platform: "braze", html: "<p>Your receipt</p>", transactional: true });
    expect(ids(r)).not.toContain("links.no-unsubscribe");
  });
  it("in-page anchors are fine; relative links are flagged", async () => {
    const r = await checkEmail({
      platform: "braze",
      html: '<a href="#deals">Deals</a><a href="/account">Account</a><a href="{{${set_user_to_unsubscribed_url}}}">u</a>',
    });
    expect(ids(r)).not.toContain("links.malformed");
    expect(ids(r)).toContain("links.relative");
  });
  it("judges only subdomains for staging hosts", () => {
    for (const h of ["go.dev", "brand.dev", "site.pages.dev", "shop.qa", "test.io", "stage.com", "devon.co.uk"])
      expect(isNonProdHost(h), h).toBe(false);
    for (const h of ["staging.brand.com", "dev.brand.co.uk", "brand-qa.brand.com", "localhost", "example.com"])
      expect(isNonProdHost(h), h).toBe(true);
  });
});

describe("live link check never acts as a recipient", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("skips unsubscribe and click-tracking links and uses HEAD only", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await checkLinksLive(
      '<a href="https://brand.example/unsubscribe?u=1">Unsubscribe</a><a href="https://u123.ct.sendgrid.net/ls/click?x">Shop</a><a href="https://www.brand.example/shop">Shop</a>',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: "HEAD" });
    expect(r.notVerified.join(" ")).toMatch(/deliberately not requested/);
  });
});

describe("sms", () => {
  const rules = RulebookSchema.parse({});
  it("'Stop by' isn't opt-out wording", async () => {
    const r = await checkChannelMessage({ channel: "sms", platform: "braze", body: "Fernbrook: Stop by this weekend for 20% off!" }, rules);
    expect(ids(r)).toContain("sms.no-opt-out");
  });
  it("accepts real opt-out wording", async () => {
    for (const body of [
      "Fernbrook: 20% off. Reply STOP to opt out",
      "Fernbrook: 20% off. Text STOP to quit",
      "Fernbrook: 20% off. Opt out: brand.example/u",
    ]) {
      expect(ids(await checkChannelMessage({ channel: "sms", platform: "braze", body }, rules)), body).not.toContain("sms.no-opt-out");
    }
  });
  it("a plain-ASCII personalized text isn't reported as Unicode", async () => {
    const r = await checkChannelMessage(
      {
        channel: "sms",
        platform: "braze",
        body: "Fernbrook: Hi {{${first_name} | default: 'there'}}, order {{custom_attribute.${order_id}}} ships today. Reply STOP to opt out",
      },
      rules,
    );
    expect(ids(r)).not.toContain("sms.unicode");
    expect(r.stats.encoding).toBe("GSM-7");
  });
});

describe("misc", () => {
  it("24/7 isn't a date", () => {
    const rules = RulebookSchema.parse({ locale: { dateFormat: "MM/DD" } });
    expect(checkHouseRules({ html: "<p>Support 24/7</p>" }, rules).map((f) => f.checkId)).not.toContain("house.date-format");
  });
  it("repeated unclosed tags are grouped", async () => {
    const r = await checkEmail({ platform: "braze", html: "<table>".repeat(50) + '<a href="{{${set_user_to_unsubscribed_url}}}">u</a>' });
    expect(r.findings.filter((f) => f.checkId === "html.unclosed-tag")).toHaveLength(1);
  });
  it("if/else branches with a link each aren't unclosed tags", async () => {
    const r = await checkEmail({
      platform: "braze",
      html: '{% if x %}<a href="https://www.b.example/a">{% else %}<a href="https://www.b.example/b">{% endif %}Shop</a><a href="{{${set_user_to_unsubscribed_url}}}">u</a>',
    });
    expect(ids(r)).not.toContain("html.unclosed-tag");
  });
  it("events are found by name, and live items with hidden triggers are listed", () => {
    const snap = demoSnapshot();
    snap.journeys[0]!.audience = [{ id: "M123", name: "Placed Order", kind: "event", mode: "trigger", confidence: "api-verified" }];
    const r = whatBreaks(snap, "event", "Placed Order");
    expect(r.dependents.map((d) => d.name)).toContain("Welcome Series");
    expect(r.unknown.length).toBeGreaterThan(0);
  });
});

describe("operator-facing output (from a simulated session)", () => {
  it("judges subject length on what people see, not the template", async () => {
    const r = await checkEmail({
      platform: "braze",
      subject: "{{${first_name} | default: 'there'}}, your weekend deals are here",
      html: '<a href="{{${set_user_to_unsubscribed_url}}}">u</a>',
    });
    const f = r.findings.find((x) => x.checkId === "house.subject-length");
    expect(f?.message ?? "").not.toMatch(/65/); // the raw template is 65 characters
  });
  it("journey diagrams show [field] instead of template code", async () => {
    const { journeyDiagram } = await import("../src/core/journey.js");
    const snap = demoSnapshot();
    const d = journeyDiagram(
      snap.journeys.find((j) => j.name === "Win-back")!,
      snap,
    );
    expect(d).toContain("[loyalty_tier]");
    expect(d).not.toContain("custom_attribute");
  });
  it("bulk-edit previews are readable text", async () => {
    const { bulkEditPreview } = await import("../src/core/ops.js");
    const p = bulkEditPreview(demoSnapshot(), "20%", "25%");
    expect(p.places[0]!.before.join(" ")).not.toMatch(/mso-hide|<|>/);
  });
});

describe("unsubscribe routes (improvement pass, 2026-11-03)", () => {
  it("a preference-center link alone is a question, not a hard failure", async () => {
    for (const html of ['<a href="{{${preference_center_url}}}">Manage preferences</a>', "<p>{% manage_preferences %}</p>"]) {
      const r = await checkEmail({ platform: "braze", html });
      const f = r.findings.find((x) => x.checkId === "links.no-unsubscribe");
      expect(f?.severity).toBe("warn");
    }
  });
  it("no opt-out route at all still fails", async () => {
    const r = await checkEmail({ platform: "braze", html: '<a href="https://fernbrook.com">Shop</a>' });
    expect(r.findings.find((x) => x.checkId === "links.no-unsubscribe")?.severity).toBe("fail");
  });
  it("Iterable's system links render instead of being reported as unknown helpers", async () => {
    const r = await checkEmail({
      platform: "iterable",
      html: '<a href="{{hostedUnsubscribeUrl}}">Opt out</a> <a href="{{viewInBrowserUrl}}">View</a>',
    });
    expect(r.notVerified.join(" ")).not.toMatch(/helper/);
    expect(ids(r)).not.toContain("links.no-unsubscribe");
  });
  it("a short personalized push title isn't flagged; a genuinely long one still is", async () => {
    const short = await checkChannelMessage({
      channel: "push",
      platform: "braze",
      title: "Hey {{${first_name}}}",
      body: "Your cart misses you",
    });
    expect(ids(short)).not.toContain("push.title-long");
    const long = await checkChannelMessage({
      channel: "push",
      platform: "braze",
      title: "Hey {{${first_name}}}, your 25% off code expires tonight",
      body: "Shop now",
    });
    expect(ids(long)).toContain("push.title-long");
  });
});

describe("typos never read as 'safe to change' (improvement pass, 2026-11-03)", () => {
  it("a misspelled segment is reported as not found, with the likely name", () => {
    const r = whatBreaks(demoSnapshot(), "segment", "VIP custmers");
    expect(r.notFound?.didYouMean).toContain("VIP members");
  });
  it("a misspelled attribute suggests the one templates use", () => {
    const r = whatBreaks(demoSnapshot(), "attribute", "loyalty_teir");
    expect(r.notFound?.didYouMean).toContain("loyalty_tier");
  });
  it("a real target has no notFound", () => {
    expect(whatBreaks(demoSnapshot(), "attribute", "loyalty_tier").notFound).toBeUndefined();
    expect(whatBreaks(demoSnapshot(), "segment", "VIP members").notFound).toBeUndefined();
  });
  it("a misspelled campaign name offers the nearest names", async () => {
    const { findItem } = await import("../src/checks/campaign.js");
    const r = findItem(demoSnapshot(), "Welcom Series");
    expect("candidates" in r && r.near && r.candidates[0]).toMatch(/^Welcome Series/);
  });
});

describe("shared rules file setting (improvement pass, 2026-11-03)", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("an empty or unfilled setting falls back to the local rules file", async () => {
    const { rulesPath } = await import("../src/core/rules.js");
    for (const v of ["", "  ", "${user_config.shared_rules_file}"]) {
      vi.stubEnv("CLO_RULES", v);
      expect(rulesPath()).toMatch(/rules\.json$/);
      expect(rulesPath()).not.toContain("user_config");
      expect(rulesPath().trim()).not.toBe("");
    }
    vi.stubEnv("CLO_RULES", "/team/drive/rules.json");
    expect(rulesPath()).toBe("/team/drive/rules.json");
  });
});

describe("QA sign-off report (0.5.2)", () => {
  it("records the verdict, every finding, what wasn't verified and a sign-off block", async () => {
    const { checkCampaign } = await import("../src/checks/campaign.js");
    const { signOffMarkdown } = await import("../src/core/report.js");
    const r = await checkCampaign(demoSnapshot(), "Price Drop Alert");
    if (!("settings" in r) || !r.settings || !r.messages) throw new Error("no result");
    const md = signOffMarkdown(r as never, {
      platform: "braze",
      operator: "Sam",
      checkedAt: new Date("2026-11-06T10:00:00Z"),
      version: "0.5.2",
    });
    expect(md).toMatch(/^# QA sign-off: Price Drop Alert/);
    expect(md).toContain("🔴 Don't launch");
    expect(md).toContain("links.non-production-host");
    expect(md).toContain("Reviewer:");
    expect(md).toContain("Checked by | Sam, 2026-11-06 10:00 UTC");
  });
});

describe("guide freshness (0.5.2)", () => {
  it("counts days since verification and goes stale after 90", async () => {
    const { guideFreshness } = await import("../src/guides/types.js");
    expect(guideFreshness("2026-11-02", new Date("2026-11-06T12:00:00Z"))).toEqual({ verifiedAt: "2026-11-02", daysAgo: 4, stale: false });
    expect(guideFreshness("2026-01-01", new Date("2026-11-06T12:00:00Z")).stale).toBe(true);
  });
  it("plans carry their freshness", async () => {
    const { howTo } = await import("../src/guides/howto.js");
    const { DEFAULT_RULES } = await import("../src/core/rules.js");
    const plan = howTo("braze", "edit-live-journey", DEFAULT_RULES);
    expect(plan.freshness.verifiedAt).toBe(plan.verifiedAt);
  });
});

// Each case here was reproduced in the plugin audit of 2026-11-09.
describe("audit fixes (0.5.6)", () => {
  afterEach(() => vi.unstubAllGlobals());
  const page = (body: string) => `<html lang="en"><body>${body}</body></html>`;
  const linkFindings = async (body: string) =>
    (await checkEmail({ platform: "braze", html: page(body) })).findings
      .filter((f) => f.checkId.startsWith("links."))
      .map((f) => `${f.severity} ${f.checkId}`);

  it("the word unsubscribe in copy or a comment is not an unsubscribe route", async () => {
    const f = await linkFindings(
      '<p>To unsubscribe, reply.</p><!-- {{unsubscribe_url}} --><a href="https://www.brand.com/x">Shop the sale</a>',
    );
    expect(f).toContain("fail links.no-unsubscribe");
    expect(await linkFindings('<a href="{{${set_user_to_unsubscribed_url}}}">Unsubscribe</a>')).not.toContain("fail links.no-unsubscribe");
  });

  it("private addresses and tunnels block; preview-looking hosts warn", async () => {
    for (const h of ["10.0.0.4", "192.168.1.9", "abc.ngrok-free.app", "api.corp.internal"]) expect(isNonProdHost(h), h).toBe(true);
    for (const h of ["brand-dev.com", "x.vercel.app"]) {
      expect(isNonProdHost(h), h).toBe(false);
      expect(looksNonProdHost(h), h).toBe(true);
    }
    expect(looksNonProdHost("www.brand.com")).toBe(false);
    const f = await linkFindings(
      '<a href="https://brand-dev.com/a">Dev shop</a><a href="http://10.0.0.4/a">Internal shop</a><a href="//www.brand.com/a">Shop</a><a href="https://www.brand.com/unsubscribe">Unsubscribe</a>',
    );
    expect(f).toContain("fail links.non-production-host");
    expect(f).toContain("warn links.non-production-host");
    expect(f).toContain("warn links.relative");
  });

  it("a push link to a preview-looking host warns", async () => {
    const r = await checkChannelMessage({
      channel: "push",
      platform: "braze",
      body: "Your order shipped",
      deepLink: "https://x.vercel.app/orders",
    });
    expect(r.findings.find((f) => f.checkId === "links.non-production-host")?.severity).toBe("warn");
  });

  it("the live link check never requests internal addresses", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await checkLinksLive('<a href="http://169.254.169.254/latest">x</a><a href="https://localhost/a">y</a>', 2000);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(r.notVerified).toHaveLength(2);
  });

  it("the live link check stops at a redirect to an internal address", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest" } }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await checkLinksLive('<a href="https://www.brand.example/go">Shop</a>', 2000, async () => ["93.184.216.34"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r.notVerified.join(" ")).toMatch(/not requested|internal/);
  });

  it("a hidden image is not a preheader", async () => {
    const r = await checkEmail({
      platform: "braze",
      html: page(
        '<img src="https://www.brand.com/p.gif" style="display:none" alt=""><p>Hello</p><a href="https://www.brand.com/unsubscribe">Unsubscribe</a>',
      ),
    });
    expect(ids(r)).toContain("html.no-preheader");
  });

  it("a rulebook with a broken pattern is rejected in plain words", async () => {
    expect(RulebookSchema.safeParse({ naming: { campaignPattern: "(" } }).success).toBe(false);
    expect(RulebookSchema.safeParse({ links: { requiredUtm: { utm_source: "[a-" } } }).success).toBe(false);
    const file = join(mkdtempSync(join(tmpdir(), "clo-rules-")), "rules.json");
    writeFileSync(file, JSON.stringify({ naming: { campaignPattern: "(" } }));
    const err = await loadRules(file).then(
      () => "",
      (e: Error) => e.message,
    );
    expect(err).toMatch(/naming\.campaignPattern: .*isn't a valid pattern/);
    expect(err).not.toContain('"code"');
  });

  it("custom personas that all lack a field still show the blank", async () => {
    const r = await checkPersonalization("Hi {{ first_name }}, welcome", "braze", [
      { name: "A", attributes: { plan: "x" } },
      { name: "B", attributes: {} },
    ]);
    expect(r.findings.map((f) => f.checkId)).toContain("personalization.dangling-punctuation");
  });

  it("Klaviyo filters render, and an unknown one is reported as not checked", async () => {
    const r = await checkPersonalization("Total {{ total|floatformat:2 }} {{ first_name|title }} {{ x|weird_one }}", "klaviyo", [
      { name: "A", attributes: { total: 12.5, first_name: "ana maria" } },
    ]);
    expect(r.renders[0]!.output).toContain("Total 12.50 Ana Maria");
    expect(r.findings.filter((f) => f.severity === "fail")).toEqual([]);
    expect(r.notVerified.join(" ")).toMatch(/"weird_one" filter isn't emulated/);
  });

  it("Iterable text helpers render and date formatting is reported, not faked", async () => {
    const r = await checkPersonalization('{{upper firstName}} {{capitalize city}} {{dateFormat signup format="MM/dd"}}', "iterable", [
      { name: "A", attributes: { firstName: "ana", city: "new york", signup: "2026-01-01" } },
    ]);
    expect(r.renders[0]!.output).toBe("ANA New York 2026-01-01");
    expect(r.notVerified.join(" ")).toMatch(/dateFormat/);
  });

  it("an Iterable comparison inside a guard for the same field is not flagged", async () => {
    const flagged = async (src: string) =>
      (await checkPersonalization(src, "iterable")).findings.filter((f) => f.checkId === "personalization.iterable-empty-comparison")
        .length;
    expect(await flagged('{{#if plan}}{{#eq plan "pro"}}P{{/eq}}{{/if}}')).toBe(0);
    expect(await flagged("{{#unless age}}{{else}}{{#gt age 3}}old{{/gt}}{{/unless}}")).toBe(0);
    expect(await flagged('{{#if plan}}ok{{else}}{{#eq plan "x"}}no{{/eq}}{{/if}}')).toBe(1);
    expect(await flagged('{{#eq tier "a"}}T{{/eq}}')).toBe(1);
  });

  it("bulk edit: literal replacement text, real after-text, and no empty patterns", () => {
    const snap = {
      campaigns: [],
      journeys: [],
      segments: [],
      contentBlocks: [],
      messages: [{ id: "m", name: "M", channel: "email", subject: "Sale now: sale ends", body: "<p>sale sale</p>" }],
    } as unknown as Snapshot;
    const r = bulkEditPreview(snap, "sale", "SUPER SALE $1");
    expect(r.totalMatches).toBe(3);
    expect(r.places.find((p) => p.where === "body")!.after[0]).toBe("…SUPER SALE $1 SUPER SALE $1…");
    expect(() => bulkEditPreview(snap, "", "y")).toThrow(/Nothing to find/);
    expect(() => bulkEditPreview(snap, "x*", "y", { regex: true })).toThrow(/matches empty text/);
    expect(() => bulkEditPreview(snap, "(", "y", { regex: true })).toThrow();
  });

  it("Iterable metrics CSV: quoted commas and thousands separators", () => {
    expect(parseCsv('﻿name,"Total Email Sends"\r\n"Promo, big","1,200"\n')).toEqual([
      ["name", "Total Email Sends"],
      ["Promo, big", "1,200"],
    ]);
  });

  it("Braze endpoint: adds https, refuses http", () => {
    expect(brazeEndpoint("rest.iad-01.braze.com/")).toBe("https://rest.iad-01.braze.com");
    expect(() => brazeEndpoint("http://rest.iad-01.braze.com")).toThrow(/https/);
  });

  it("content blocks expand inside content blocks, and a loop ends", () => {
    const blocks = [
      { name: "a", body: "A[{{content_blocks.${b}}}]" },
      { name: "b", body: "B{{content_blocks.${a}}}" },
    ];
    expect(expandContentBlocks("{{content_blocks.${a}}}", blocks)).toBe("A[B{{content_blocks.${a}}}]");
    expect(expandContentBlocks("{{content_blocks.${a}}}", [blocks[0]!, { name: "b", body: "B" }])).toBe("A[B]");
  });

  it("the CLI says when one subject was applied to several files", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clo-cli-notes-"));
    for (const n of ["a.html", "b.html"])
      writeFileSync(join(dir, n), page('<p>Hi</p><a href="https://www.brand.com/unsubscribe">Unsubscribe</a>'));
    let out = "";
    await runCheckCli([dir, "--subject", "Hello there", "--json"], (s) => (out += s));
    expect(JSON.parse(out).notes[0]).toMatch(/--subject was applied to all 2 files/);
    out = "";
    await runCheckCli([join(dir, "a.html"), "--subject", "Hello there", "--json"], (s) => (out += s));
    expect(JSON.parse(out).notes).toEqual([]);
  });
});
