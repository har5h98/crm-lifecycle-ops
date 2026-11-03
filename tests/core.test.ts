import { describe, expect, it } from "vitest";
import { checkCampaign } from "../src/checks/campaign.js";
import { checkEmail } from "../src/checks/email.js";
import { findOverlaps, whatBreaks } from "../src/core/graph.js";
import { evaluateHealth } from "../src/core/health.js";
import { checkJourneyStructure, journeyDiagram } from "../src/core/journey.js";
import { bulkEditPreview } from "../src/core/ops.js";
import { applyRules, RulebookSchema } from "../src/core/rules.js";
import { diffSnapshots } from "../src/core/snapshot.js";
import { demoSnapshot } from "../src/demo/fernbrook.js";

describe("what breaks (demo account)", () => {
  const snap = demoSnapshot();
  it("finds every live use of an attribute, through templates and segments", () => {
    const r = whatBreaks(snap, "attribute", "loyalty_tier");
    const names = r.dependents.map((d) => d.name);
    expect(names).toEqual(expect.arrayContaining(["Weekend Deals Blast", "Win-back", "Lapsed 30 days", "VIP members"]));
    expect(r.dependents.find((d) => d.name === "Lapsed 30 days")!.confidence).toBe("parsed-from-description");
  });
  it("uses on-screen audience data and lists live items it can't rule out", () => {
    const r = whatBreaks(snap, "segment", "Lapsed 30 days");
    expect(r.dependents).toEqual([expect.objectContaining({ name: "Win-back", confidence: "seen-on-screen" })]);
    expect(r.unknown.map((u) => u.name)).toEqual(expect.arrayContaining(["Weekend Deals Blast", "Welcome Series"]));
  });
  it("maps content block usage from the platform's inclusion data", () => {
    expect(whatBreaks(snap, "content-block", "footer_v2").summary.activeAffected).toBe(4);
  });
  it("finds overlaps for a planned journey", () => {
    const o = findOverlaps(snap, { segments: ["Lapsed 30 days"] });
    expect(o.liveOverlaps.map((x) => x.name)).toEqual(["Win-back"]);
  });
});

describe("journeys", () => {
  const snap = demoSnapshot();
  it("flags dead-end branches, empty message steps and unreachable steps", () => {
    const welcome = checkJourneyStructure(snap.journeys[0]!).findings.map((f) => f.checkId);
    expect(welcome).toEqual(expect.arrayContaining(["journey.empty-message-step", "journey.unreachable-steps"]));
    expect(checkJourneyStructure(snap.journeys[1]!).findings.map((f) => f.checkId)).toContain("journey.dead-end-branch");
  });
  it("draws a Mermaid diagram", () => {
    const d = journeyDiagram(snap.journeys[0]!, snap);
    expect(d).toMatch(/^flowchart TD/);
    expect(d).toContain("Welcome to Fernbrook Market");
  });
});

describe("campaign check", () => {
  it("expands content blocks, so the footer's unsubscribe counts", async () => {
    const r = await checkCampaign(demoSnapshot(), "Price Drop Alert");
    if (!("messages" in r) || !r.messages) throw new Error("expected a result");
    const ids = r.messages.flatMap((m) => m.findings.map((f) => f.checkId));
    expect(ids).toContain("links.non-production-host");
    expect(ids).not.toContain("links.no-unsubscribe");
    expect(r.settings!.map((f) => f.checkId)).toContain("campaign.no-conversion-event");
  });
  it("lists candidates when a name is ambiguous", async () => {
    expect(await checkCampaign(demoSnapshot(), "e")).toHaveProperty("candidates");
  });
});

describe("house rules", () => {
  const html = `<div style="display:none">x</div><p>Our favourite colour at fernbrook market!</p>
<a href="https://www.fernbrook.example/a?utm_source=braze&utm_medium=Email">A</a><a href="https://other.example/b">B</a><a href="#">unsubscribe</a>`;
  it("enforces brand name, spelling, domains, UTM format and required text", async () => {
    const rules = RulebookSchema.parse({
      locale: { spelling: "US" },
      brand: { names: ["Fernbrook Market"] },
      links: { domains: ["fernbrook.example"], requiredUtm: { utm_source: "", utm_medium: "^[a-z_]+$", utm_campaign: "" } },
      compliance: { requiredText: ["100 Example Way"] },
    });
    const ids = (await checkEmail({ html, platform: "braze" }, rules)).findings.map((f) => f.checkId);
    expect(ids).toEqual(expect.arrayContaining(["house.brand-name", "house.spelling-variant", "house.off-domain-link", "house.utm-format", "house.utm-missing", "house.required-text-missing"]));
  });
  it("lets teams waive or re-grade checks, but never locked ones", () => {
    const rules = RulebookSchema.parse({
      severity: { "links.insecure-http": "off", "links.no-unsubscribe": "off" },
      exceptions: [{ checkId: "html.img-missing-alt", reason: "decorative spacer images", addedAt: "2026-11-02" }],
    });
    const r = applyRules(
      [
        { checkId: "links.insecure-http", severity: "warn", message: "" },
        { checkId: "links.no-unsubscribe", severity: "fail", message: "" },
        { checkId: "html.img-missing-alt", severity: "warn", message: "" },
      ],
      rules,
    );
    expect(r.findings.map((f) => f.checkId)).toEqual(["links.no-unsubscribe"]);
    expect(r.waived.map((w) => w.reason)).toEqual(["turned off in house rules", "decorative spacer images"]);
  });
  it("uses the team's own personas plus an empty profile", async () => {
    const rules = RulebookSchema.parse({ personalization: { personas: [{ name: "Gold member", attributes: { first_name: "Ana" } }] } });
    const r = await checkEmail({ html: "<p>Hi {{${first_name}}},</p><a>unsubscribe</a>", platform: "braze" }, rules);
    expect(r.findings.find((f) => f.checkId === "personalization.dangling-punctuation")?.persona).toBe("Empty profile");
  });
});

describe("launch health", () => {
  it("grades rates against stated thresholds", () => {
    const h = evaluateHealth({ period: "7d", sent: 10000, delivered: 9900, bounces: 100, unsubscribes: 120, spamReports: 35, notes: [] });
    expect(h.verdict).toBe("act now");
    expect(h.findings.map((f) => f.checkId)).toEqual(expect.arrayContaining(["launch.unsubscribe-high", "launch.spam-high"]));
    expect(evaluateHealth({ period: "7d", sent: 0, notes: [] }).verdict).toBe("no data");
  });
});

describe("diff and bulk edit", () => {
  it("reports status and content changes, live first", () => {
    const a = demoSnapshot();
    const b = demoSnapshot();
    b.campaigns[2]!.status = "live";
    b.messages[0]!.subject = "New subject";
    b.campaigns.splice(1, 1);
    const changes = diffSnapshots(a, b);
    expect(changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Holiday Recipes", change: "status", detail: "draft → live" }),
        expect.objectContaining({ name: "Weekend Deals", change: "content" }),
        expect.objectContaining({ name: "Price Drop Alert", change: "removed" }),
      ]),
    );
  });
  it("previews replacements without writing", () => {
    const p = bulkEditPreview(demoSnapshot(), "fernbrook.example/help", "fernbrook.example/support");
    expect(p.totalMatches).toBe(1);
    expect(p.places[0]!.after[0]).toContain("/support");
  });
});
