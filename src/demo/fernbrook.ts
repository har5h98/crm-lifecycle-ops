import type { Snapshot } from "../core/snapshot.js";

// A made-up Braze workspace for "Fernbrook Market", a fictional grocery delivery brand.
// It exists so anyone can try every command without connecting an account, and it contains
// deliberate problems for the tools to find. No real company, customer or template is used.

const footer = `<table><tr><td style="font-size:12px">Fernbrook Market · 100 Example Way, Springfield, ST 00000<br>
<a href="{{\${set_user_to_unsubscribed_url}}}">Unsubscribe</a> · <a href="https://www.fernbrook.example/preferences">Email preferences</a></td></tr></table>`;

const wrap = (preheader: string, inner: string) =>
  `<html><body><div style="display:none;mso-hide:all">${preheader}</div><table><tr><td>${inner}</td></tr></table>{{content_blocks.\${footer_v2}}}</body></html>`;

export function demoSnapshot(): Snapshot {
  const unknown = [{ id: "?", kind: "unknown" as const, mode: "include" as const, confidence: "unknown" as const }];
  return {
    platform: "braze",
    workspace: "demo",
    takenAt: new Date().toISOString(),
    demo: true,
    gaps: [
      "Demo data for a fictional brand (Fernbrook Market).",
      "Braze's API doesn't expose which segment a campaign or Canvas targets; those audience links are marked unknown.",
    ],
    segments: [
      {
        id: "seg_lapsed",
        name: "Lapsed 30 days",
        kind: "segment",
        description: "Last used app more than 30 days ago AND custom attribute loyalty_tier is not blank",
      },
      { id: "seg_new", name: "New signups (7 days)", kind: "segment", description: "First used app less than 7 days ago" },
      { id: "seg_vip", name: "VIP members", kind: "segment", description: "Custom attribute loyalty_tier equals Gold" },
    ],
    contentBlocks: [
      { id: "cb_footer", name: "footer_v2", body: footer, usedBy: ["m_deals", "m_drop", "m_welcome", "m_tips", "m_winback"] },
    ],
    campaigns: [
      {
        id: "c_deals",
        name: "Weekend Deals Blast",
        status: "live",
        channels: ["email"],
        messageIds: ["m_deals"],
        audience: unknown,
        conversionEvents: ["Order Placed"],
        tags: ["promo"],
      },
      {
        id: "c_drop",
        name: "Price Drop Alert",
        status: "live",
        channels: ["email"],
        messageIds: ["m_drop"],
        audience: unknown,
        conversionEvents: [],
      },
      { id: "c_recipes", name: "Holiday Recipes", status: "draft", channels: ["email"], messageIds: ["m_recipes"], audience: unknown },
      {
        id: "c_lunch",
        name: "Lunch Rush Push",
        status: "live",
        channels: ["push"],
        messageIds: ["m_lunch_push"],
        audience: unknown,
        conversionEvents: ["Order Placed"],
      },
      {
        id: "c_flash",
        name: "Flash Sale Text",
        status: "scheduled",
        channels: ["sms"],
        messageIds: ["m_flash_sms"],
        audience: unknown,
        conversionEvents: ["Order Placed"],
      },
      {
        id: "c_app",
        name: "New App Features",
        status: "live",
        channels: ["in-app"],
        messageIds: ["m_app_iam"],
        audience: unknown,
        conversionEvents: [],
      },
    ],
    journeys: [
      {
        id: "j_welcome",
        name: "Welcome Series",
        status: "live",
        entryStepIds: ["w1"],
        stepsKnown: true,
        audience: unknown,
        conversionEvents: ["First Order"],
        steps: [
          { id: "w1", name: "Welcome email", type: "message", messageIds: ["m_welcome"], next: ["w2"] },
          { id: "w2", name: "Wait 2 days", type: "delay", messageIds: [], next: ["w3"] },
          { id: "w3", name: "Ordered yet?", type: "audience_paths", messageIds: [], next: ["w4", "w5"] },
          { id: "w4", name: "Recipe tips", type: "message", messageIds: ["m_tips"], next: [] },
          { id: "w5", name: "First-order nudge", type: "message", messageIds: [], next: [] },
          { id: "w6", name: "Old survey (unused)", type: "message", messageIds: [], next: [] },
        ],
      },
      {
        id: "j_winback",
        name: "Win-back",
        status: "live",
        entryStepIds: ["b1"],
        stepsKnown: true,
        // Filled in from the Braze dashboard, not the API, to show how gaps get closed.
        audience: [{ id: "seg_lapsed", kind: "segment", mode: "include", confidence: "seen-on-screen" }],
        conversionEvents: [],
        steps: [
          { id: "b1", name: "We miss you", type: "message", messageIds: ["m_winback"], next: ["b2"] },
          { id: "b2", name: "Clicked?", type: "decision_split", messageIds: [], next: [] },
        ],
      },
    ],
    messages: [
      {
        id: "m_lunch_push",
        name: "Lunch Rush",
        channel: "push",
        platformChannel: "ios_push",
        ownerId: "c_lunch",
        title: "{{${first_name}}}, lunch is on us: free delivery until 2pm today only",
        body: "Order by 2pm for free delivery on everything in the deli and hot food counters.",
        deepLink: "https://staging.fernbrook.example/deli",
      },
      {
        id: "m_flash_sms",
        name: "Flash Sale",
        channel: "sms",
        platformChannel: "sms",
        ownerId: "c_flash",
        body: "Hi {{${first_name} | default: 'there'}}! Today’s flash sale: 30% off berries & stone fruit — ends at midnight. Shop now: https://www.fernbrook.example/flash",
      },
      {
        id: "m_app_iam",
        name: "New App Features",
        channel: "in-app",
        platformChannel: "in_app_message",
        ownerId: "c_app",
        title: "Reorder in one tap",
        body: "Your past orders now live on the home screen.",
        buttons: [
          { text: "Try it", link: "fernbrook://orders" },
          { text: "", link: "fernbrook://home" },
        ],
      },
      {
        id: "m_deals",
        name: "Weekend Deals",
        channel: "email",
        ownerId: "c_deals",
        subject: "{{${first_name} | default: 'there'}}, your weekend deals are here",
        preheader: "Fresh picks, lower prices",
        from: "deals@fernbrook.example",
        body: wrap(
          "Fresh picks, lower prices",
          `<p>Hi {{\${first_name} | default: 'there'}},</p><p>As a {{custom_attribute.\${loyalty_tier} | default: 'member'}} member you get early access.</p>
<a href="https://www.fernbrook.example/deals?utm_source=braze&utm_medium=email&utm_campaign=weekend_deals">Shop deals</a>
<img src="https://cdn.fernbrook.example/deals.png" alt="Weekend deals">`,
        ),
      },
      {
        id: "m_drop",
        name: "Price Drop",
        channel: "email",
        ownerId: "c_drop",
        subject: "Prices just dropped on your favorites",
        from: "alerts@fernbrook.example",
        body: wrap(
          "Your saved items are cheaper today",
          `<p>Hi {{\${first_name}}},</p><p>Items you saved are on sale.</p>
<a href="https://staging.fernbrook.example/saved?utm_source=braze&utm_medium=email&utm_campaign=price_drop">See items</a>
<a href="https://www.fernbrook.example/help">Help</a>
<img src="https://cdn.fernbrook.example/drop.png">`,
        ),
      },
      {
        id: "m_recipes",
        name: "Holiday Recipes",
        channel: "email",
        ownerId: "c_recipes",
        subject: "Holiday recipes from the Fernbrook kitchen",
        body: wrap(
          "Five dishes, one list",
          `<p>Hello {{\${first_name} | default: 'there'}},</p><a href="https://www.fernbrook.example/recipes">Get recipes</a>`,
        ),
      },
      {
        id: "m_welcome",
        name: "Welcome email",
        channel: "email",
        ownerId: "j_welcome",
        subject: "Welcome to Fernbrook Market",
        from: "hello@fernbrook.example",
        body: wrap(
          "Your first order ships free",
          `<p>Welcome, {{\${first_name} | default: 'there'}}!</p><a href="https://www.fernbrook.example/start?utm_source=braze&utm_medium=email&utm_campaign=welcome">Start shopping</a>`,
        ),
      },
      {
        id: "m_tips",
        name: "Recipe tips",
        channel: "email",
        ownerId: "j_welcome",
        subject: "3 dinners in 20 minutes",
        from: "hello@fernbrook.example",
        body: wrap(
          "Quick, fresh, easy",
          `<p>Hi {{\${first_name} | default: 'there'}},</p><a href="https://www.fernbrook.example/tips?utm_source=braze&utm_medium=email&utm_campaign=welcome">Read tips</a>`,
        ),
      },
      {
        id: "m_winback",
        name: "We miss you",
        channel: "email",
        ownerId: "j_winback",
        subject: "We saved you a {{custom_attribute.${loyalty_tier}}} discount",
        from: "hello@fernbrook.example",
        body: wrap(
          "Come back for 20% off",
          `<p>Hi {{\${first_name} | default: 'there'}},</p><p>Your {{custom_attribute.\${loyalty_tier}}} perks are waiting.</p>
<a href="https://www.fernbrook.example/comeback?utm_source=braze&utm_medium=email&utm_campaign=winback">Claim 20% off</a>`,
        ),
      },
    ],
  };
}
