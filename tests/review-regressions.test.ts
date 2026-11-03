import { afterEach, describe, expect, it, vi } from "vitest";
import { checkChannelMessage } from "../src/checks/channels.js";
import { checkEmail } from "../src/checks/email.js";
import { checkHouseRules } from "../src/checks/house.js";
import { checkLinksLive, isNonProdHost } from "../src/checks/links.js";
import { whatBreaks } from "../src/core/graph.js";
import { RulebookSchema } from "../src/core/rules.js";
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
