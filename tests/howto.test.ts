import { describe, expect, it } from "vitest";
import { RulebookSchema } from "../src/core/rules.js";
import { demoSnapshot } from "../src/demo/fernbrook.js";
import { GUIDES } from "../src/guides/index.js";
import { howTo } from "../src/guides/howto.js";
import { TASKS, type TaskId } from "../src/guides/types.js";

describe("procedure library", () => {
  it("covers every task on every platform, each with steps and a source", () => {
    for (const g of Object.values(GUIDES)) {
      for (const t of Object.keys(TASKS) as TaskId[]) {
        const p = g.tasks[t];
        expect(p.steps.length, `${g.platform} ${t}`).toBeGreaterThan(0);
        expect(p.docs.every((d) => d.startsWith("https://")), `${g.platform} ${t}`).toBe(true);
      }
    }
  });
  it("writes personalization in each platform's syntax", () => {
    expect(GUIDES.braze.personalization.withFallback("first_name", "there")).toBe("{{${first_name} | default: 'there'}}");
    expect(GUIDES.klaviyo.personalization.withFallback("first_name", "there")).toBe("{{ first_name|default:'there' }}");
    expect(GUIDES.iterable.personalization.withFallback("firstName", "there")).toBe('{{defaultIfEmpty firstName "there"}}');
  });
});

describe("how_to", () => {
  const rules = RulebookSchema.parse({
    naming: { example: "LC_email_lapsed_202611" },
    senders: { allowed: ["hello@fernbrook.example"] },
    links: { requiredUtm: { utm_source: "^braze$", utm_campaign: "" } },
    personalization: { greetingFallback: "friend" },
  });
  it("fills a build plan with house rules and assets to reuse", () => {
    const r = howTo("braze", "create-journey", rules, demoSnapshot(), { audience: "lapsed customers", attributes: ["first_name", "loyalty_tier"] });
    const setup = r.yourSetup.join(" ");
    expect(setup).toContain("LC_email_lapsed_202611");
    expect(setup).toContain("hello@fernbrook.example");
    expect(setup).toContain("{{${first_name} | default: 'friend'}}");
    expect(setup).toContain("{{custom_attribute.${loyalty_tier}");
    expect(r.reuse.join(" ")).toContain("Lapsed 30 days");
    expect(r.reuse.join(" ")).toContain("footer_v2");
    expect(r.steps[0]).toContain("Messaging > Canvas");
  });
  it("warns before editing something live, including shared blocks used elsewhere", () => {
    const r = howTo("braze", "edit-live-journey", rules, demoSnapshot(), { target: "Welcome Series" });
    expect(r.warnings.join(" ")).toMatch(/is live/);
    expect(r.warnings.join(" ")).toMatch(/footer_v2.*other live program/);
    expect(r.gotchas.join(" ")).toContain("conversion events");
  });
  it("works without a snapshot", () => {
    const r = howTo("klaviyo", "create-campaign", rules, undefined, { channels: ["sms"] });
    expect(r.reuse[0]).toMatch(/refresh/);
    expect(r.channelNotes.join(" ")).toContain("STOP");
  });
});
