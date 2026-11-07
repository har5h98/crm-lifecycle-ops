import { describe, expect, it } from "vitest";
import { checkEmail } from "../src/checks/email.js";
import { checkLinks } from "../src/checks/links.js";
import type { Platform } from "../src/core/model.js";

// Idioms from real Braze, Klaviyo and Iterable templates that once produced false alarms (2026-11-06 sweep).
// An operator's first real template must not get a wrong "Don't send".
const UNSUB: Record<Platform, string> = {
  braze: '<a href="{{${set_user_to_unsubscribed_url}}}">Unsubscribe</a>',
  klaviyo: "{% unsubscribe %}",
  iterable: '<a href="{{unsubscribeUrl}}">Unsubscribe</a>',
};
const check = (platform: Platform, body: string) =>
  checkEmail({
    platform,
    html: `<html lang="en"><body><div style="display:none">Preview</div><p>${body}</p>${UNSUB[platform]}</body></html>`,
  });
const problems = async (platform: Platform, body: string) =>
  (await check(platform, body)).findings.filter((f) => f.severity !== "info").map((f) => f.checkId);

describe("no false alarms on everyday template idioms", () => {
  it("Braze: output tags inside logic tags", async () => {
    const r = await check("braze", "{% assign tier = {{custom_attribute.${loyalty_tier}}} %}You're {{tier | default: 'a member'}}");
    expect(r.findings.filter((f) => f.severity !== "info")).toEqual([]);
    expect(r.variables).toContain("custom_attribute.loyalty_tier");
  });
  it("Braze: attribute names with spaces", async () => {
    expect(await problems("braze", "{{custom_attribute.${Favorite Color} | default: 'blue'}}")).toEqual([]);
  });
  it("Iterable: {{now}} with a format, and data-feed [[ ]] syntax, are not verified rather than broken", async () => {
    const r = await check("iterable", '{{now format="yyyy"}} [[items.0.title]]');
    expect(r.findings.filter((f) => f.severity !== "info")).toEqual([]);
    expect(r.notVerified.join(" ")).toMatch(/now/);
    expect(r.notVerified.join(" ")).toMatch(/Data feed/);
  });
  it("Iterable: plain fields aren't reported as unknown helpers", async () => {
    const r = await check("iterable", "{{email}} {{userId}}");
    expect(r.notVerified.join(" ")).not.toMatch(/helper "(email|userId)"/);
  });
});

describe("UTM consistency only compares links teams actually tag", () => {
  const html = (extra: string) =>
    `<a href="https://shop.com/a?utm_source=email">Shop</a> <a href="https://shop.com/b?utm_source=email">New</a> ${extra} <a href="https://shop.com/unsubscribe">Unsubscribe</a>`;
  it("ignores social links and footer utility pages", () => {
    const ids = checkLinks(
      html(
        '<a href="https://instagram.com/shop">Instagram</a> <a href="https://shop.com/privacy">Privacy policy</a> <a href="https://shop.com/help">Help</a>',
      ),
    ).map((f) => f.checkId);
    expect(ids).not.toContain("links.utm-inconsistent");
  });
  it("still catches an untagged product link", () => {
    const f = checkLinks(html('<a href="https://shop.com/gift-cards">Gift cards</a>')).find((x) => x.checkId === "links.utm-inconsistent");
    expect(f?.message).toContain("Gift cards");
  });
});
