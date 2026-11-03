import { describe, expect, it } from "vitest";
import { checkChannelMessage, smsSegments } from "../src/checks/channels.js";
import { RulebookSchema } from "../src/core/rules.js";

const ids = (r: { findings: { checkId: string }[] }) => r.findings.map((f) => f.checkId);

describe("sms segments", () => {
  it("counts GSM-7 and Unicode segments the way carriers bill them", () => {
    expect(smsSegments("a".repeat(160))).toMatchObject({ encoding: "GSM-7", segments: 1 });
    expect(smsSegments("a".repeat(161))).toMatchObject({ encoding: "GSM-7", segments: 2 });
    expect(smsSegments("a".repeat(159) + "€")).toMatchObject({ encoding: "GSM-7", length: 161, segments: 2 });
    expect(smsSegments("It’s here")).toMatchObject({ encoding: "UCS-2", segments: 1, nonGsm: ["’"] });
    expect(smsSegments("x".repeat(71) + "’")).toMatchObject({ encoding: "UCS-2", segments: 2 });
  });
});

describe("sms checks", () => {
  const rules = RulebookSchema.parse({ brand: { names: ["Fernbrook Market"] } });
  it("flags smart quotes, missing opt-out, missing brand and staging links", async () => {
    const r = await checkChannelMessage({ channel: "sms", platform: "braze", body: "Your order’s ready! https://staging.fernbrook.example/o" }, rules);
    expect(ids(r)).toEqual(expect.arrayContaining(["sms.unicode", "sms.no-opt-out", "sms.no-brand-name", "links.non-production-host"]));
    expect(r.findings.find((f) => f.checkId === "sms.unicode")!.fix).toContain("’ → '");
  });
  it("passes a compliant text", async () => {
    const r = await checkChannelMessage({ channel: "sms", platform: "braze", body: "Fernbrook Market: 20% off produce today. Reply STOP to opt out." }, rules);
    expect(r.summary).toEqual({ fail: 0, warn: 0, info: 0 });
  });
  it("judges length on the longest persona", async () => {
    const r = await checkChannelMessage(
      { channel: "sms", platform: "braze", body: `Fernbrook Market: hi {{\${first_name} | default: 'there'}}, ${"x".repeat(250)} Reply STOP to opt out` },
      rules,
    );
    expect(ids(r)).toContain("sms.too-many-segments");
  });
});

describe("push checks", () => {
  it("catches long titles, blanks for empty profiles and bad deep links", async () => {
    const rules = RulebookSchema.parse({ push: { deepLinkPrefixes: ["fernbrook://"] } });
    const r = await checkChannelMessage(
      { channel: "push", platform: "braze", title: "{{${first_name}}}, your weekend deals are waiting", body: "Fresh picks inside", deepLink: "https://staging.fernbrook.example/deals" },
      rules,
    );
    expect(ids(r)).toEqual(expect.arrayContaining(["push.title-long", "personalization.dangling-punctuation", "push.deep-link-scheme", "links.non-production-host"]));
  });
  it("fails an empty push", async () => {
    expect(ids(await checkChannelMessage({ channel: "push", platform: "klaviyo", body: "" }))).toContain("push.empty");
  });
});

describe("in-app checks", () => {
  it("checks text in-app messages and their buttons", async () => {
    const rules = RulebookSchema.parse({ inApp: { requireButton: true } });
    const r = await checkChannelMessage({ channel: "in-app", platform: "iterable", body: "x".repeat(200), buttons: [{ text: "", link: "http://localhost/x" }] }, rules);
    expect(ids(r)).toEqual(expect.arrayContaining(["inapp.body-long", "inapp.button-no-text", "links.non-production-host", "links.insecure-http"]));
  });
  it("runs structural HTML checks on HTML in-app messages but not email-only ones", async () => {
    const r = await checkChannelMessage({ channel: "in-app", platform: "braze", body: "<div><p>Hi</p><img src='a.png'></div>" });
    expect(ids(r)).toContain("html.img-missing-alt");
    expect(ids(r)).not.toContain("links.no-unsubscribe");
    expect(ids(r)).not.toContain("html.no-preheader");
  });
});
