import { describe, expect, it } from "vitest";
import { brazeAdapter } from "../src/adapters/braze.js";
import { iterableAdapter } from "../src/adapters/iterable.js";
import { klaviyoAdapter } from "../src/adapters/klaviyo.js";

// Each adapter runs against canned responses shaped like the vendors' published API examples.
// These prove the mapping; field-testing against real accounts is tracked separately.
function mockFetch(routes: [RegExp, unknown][]): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    const hit = routes.find(([re]) => re.test(url));
    if (!hit) return new Response(JSON.stringify({ error: `no mock for ${url}` }), { status: 404 });
    return new Response(typeof hit[1] === "string" ? hit[1] : JSON.stringify(hit[1]), { status: 200 });
  }) as typeof fetch;
}

describe("braze adapter", () => {
  it("maps campaigns, Canvas steps, segments and content block usage", async () => {
    const fetcher = mockFetch([
      [/campaigns\/list/, { campaigns: [{ id: "c1", name: "Promo", last_edited: "2026-10-01" }] }],
      [/campaigns\/details/, { name: "Promo", draft: false, archived: false, enabled: true, channels: ["email"], conversion_behaviors: [{ type: "Makes Purchase" }], messages: { v1: { channel: "email", name: "Promo email", subject: "Hi", body: "<p>{{${first_name}}}</p>", from: "a@b.example" } } }],
      [/canvas\/list/, { canvases: [{ id: "k1", name: "Welcome", last_edited: "2026-10-01" }] }],
      [/canvas\/details/, { name: "Welcome", draft: false, enabled: true, archived: false, variants: [{ first_step_ids: ["s1"] }], steps: [{ id: "s1", name: "Email", type: "message", next_step_ids: ["s2"], messages: { m1: { channel: "email", body: "<p>x</p>" } } }, { id: "s2", name: "Split", type: "audience_paths", next_paths: [{ name: "a", next_step_id: "s1" }] }] }],
      [/segments\/list/, { segments: [{ id: "g1", name: "VIP" }] }],
      [/segments\/details/, { name: "VIP", description: "loyalty_tier equals Gold" }],
      [/content_blocks\/list/, { content_blocks: [{ content_block_id: "b1", name: "footer" }] }],
      [/content_blocks\/info/, { name: "footer", content: "<a>unsubscribe</a>", inclusion_data: [{ message_variation_id: "v1" }] }],
    ]);
    const snap = await brazeAdapter({ fetcher, env: { BRAZE_API_KEY: "k", BRAZE_REST_ENDPOINT: "https://rest.example" } }).snapshot();
    expect(snap.campaigns[0]).toMatchObject({ id: "c1", status: "live", messageIds: ["v1"], audience: [{ confidence: "unknown" }] });
    expect(snap.journeys[0]!.steps[1]!.next).toEqual(["s1"]);
    expect(snap.journeys[0]!.entryStepIds).toEqual(["s1"]);
    expect(snap.segments[0]!.description).toContain("loyalty_tier");
    expect(snap.contentBlocks[0]!.usedBy).toEqual(["v1"]);
    expect(snap.messages.find((m) => m.id === "v1")!.subject).toBe("Hi");
  });

  it("explains how to connect when keys are missing", () => {
    expect(() => brazeAdapter({ env: {} })).toThrow(/BRAZE_API_KEY/);
  });
});

describe("klaviyo adapter", () => {
  it("maps campaign audiences, templates and flow graphs", async () => {
    const fetcher = mockFetch([
      [/\/segments\/S1/, { data: { id: "S1", type: "segment", attributes: { name: "Engaged", definition: { condition_groups: [{ conditions: [{ type: "profile-property", property: "properties['loyalty_tier']" }] }] } } } }],
      [/\/segments\?/, { data: [{ id: "S1", type: "segment", attributes: { name: "Engaged" } }], links: {} }],
      [/\/lists\?/, { data: [{ id: "L1", type: "list", attributes: { name: "Newsletter" } }], links: {} }],
      [/\/campaigns\?/, { data: [{ id: "C1", type: "campaign", attributes: { definition: { name: "Fall sale", archived: false }, updated_at: "2026-10-01" }, relationships: { "campaign-audiences": { data: [{ type: "campaign-audience", id: "A1" }] }, "campaign-messages": { data: [{ type: "campaign-message", id: "M1" }] } } }], included: [{ id: "A1", type: "campaign-audience", attributes: { definition: { included: ["S1"], excluded: ["L1"] } } }, { id: "M1", type: "campaign-message", attributes: { definition: { status: "scheduled" } }, relationships: { "campaign-variations": { data: [{ id: "V1", type: "campaign-variation" }] } } }], links: {} }],
      [/campaign-variations\/V1/, { data: { id: "V1", type: "campaign-variation", attributes: { definition: { details: { channel: "email", subject: "Fall is here", preview_text: "Save 20%", from_email: "hi@x.example" } } } } }],
      [/campaign-messages\/M1\/template/, { data: { id: "T1", type: "template", attributes: { html: "<p>{{ first_name }}</p>" } } }],
      [/\/flows\/F1\?/, { data: { id: "F1", type: "flow", attributes: { definition: { entry_action_id: "a1", triggers: [{ type: "list", id: "L1" }], actions: [{ id: "a1", type: "send-email", links: { next: "a2" }, data: { message: { name: "Welcome", subject_line: "Welcome!", template_id: "T2" } } }, { id: "a3", type: "send-mobile-push", links: {}, data: { message: { title: "Hi", body: "Your cart", on_open: "link", ios_link: "fern://cart" } } }, { id: "a2", type: "time-delay", links: {} }] } } } }],
      [/\/flows\?/, { data: [{ id: "F1", type: "flow", attributes: { name: "Welcome flow", status: "live", archived: false } }], links: {} }],
      [/\/templates\/T2/, { data: { id: "T2", type: "template", attributes: { html: "<p>hello</p>" } } }],
    ]);
    const snap = await klaviyoAdapter({ fetcher, env: { KLAVIYO_API_KEY: "pk_test" } }).snapshot();
    const c = snap.campaigns[0]!;
    expect(c).toMatchObject({ name: "Fall sale", status: "scheduled" });
    expect(c.audience).toEqual([
      { id: "S1", kind: "segment", mode: "include", confidence: "api-verified" },
      { id: "L1", kind: "list", mode: "exclude", confidence: "api-verified" },
    ]);
    expect(snap.messages.find((m) => m.id === "M1")).toMatchObject({ subject: "Fall is here", body: "<p>{{ first_name }}</p>" });
    const f = snap.journeys[0]!;
    expect(f).toMatchObject({ status: "live", entryStepIds: ["a1"], audience: [{ id: "L1", kind: "list", mode: "trigger" }] });
    expect(f.steps[0]!.next).toEqual(["a2"]);
    expect(snap.messages.find((m) => m.id === "F1:a1")).toMatchObject({ subject: "Welcome!", body: "<p>hello</p>", channel: "email" });
    expect(snap.messages.find((m) => m.id === "F1:a3")).toMatchObject({ channel: "push", title: "Hi", deepLink: "fern://cart" });
  });
});

describe("iterable adapter", () => {
  it("maps campaigns, lists, templates and journeys", async () => {
    const fetcher = mockFetch([
      [/\/lists/, { lists: [{ id: 7, name: "All users", listType: "Standard" }] }],
      [/\/campaigns\b(?!\/metrics)/, { campaigns: [{ id: 11, name: "Order shipped", campaignState: "Running", templateId: 99, messageMedium: "Email", listIds: [7], suppressionListIds: [], workflowId: 5, type: "Triggered", updatedAt: 1 }] }],
      [/templates\/email\/get/, { templateId: 99, name: "Shipped", subject: "On its way", preheaderText: "Track it", fromEmail: "x@y.example", html: "<p>{{firstName}}</p>" }],
      [/\/journeys/, { journeys: [{ id: 5, name: "Post-purchase", enabled: true }] }],
    ]);
    const snap = await iterableAdapter({ fetcher, env: { ITERABLE_API_KEY: "k" } }).snapshot();
    expect(snap.campaigns[0]).toMatchObject({ id: "11", status: "live", audience: [{ id: "7", kind: "list", confidence: "api-verified" }] });
    expect(snap.messages[0]).toMatchObject({ subject: "On its way", body: "<p>{{firstName}}</p>" });
    expect(snap.journeys[0]).toMatchObject({ status: "live", stepsKnown: false });
    expect(snap.journeys[0]!.steps[0]!.messageIds).toEqual(["template:99"]);
  });
});
