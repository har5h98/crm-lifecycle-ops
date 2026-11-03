import type { PlatformGuide } from "./types.js";

// Verified 2026-11-02. API facts come from Iterable's API spec (v1.8). UI procedures come from
// support.iterable.com articles, read through search excerpts because the site blocks automated
// reading, so exact button labels may differ slightly in the live app.
const S = "https://support.iterable.com/hc/en-us/articles";

export const iterable: PlatformGuide = {
  platform: "iterable",
  verifiedAt: "2026-11-02",
  terms: { journey: "Journey", campaign: "Campaign", segment: "Dynamic list", list: "List", sharedContent: "Snippet", testUsers: "Internal list" },
  personalization: {
    attribute: (n) => `{{${n}}}`,
    customAttribute: (n) => `{{${n}}}`,
    withFallback: (n, fb) => `{{defaultIfEmpty ${n} "${fb}"}}`,
    conditional: (n) => `{{#if ${n}}}…{{else}}…{{/if}}`,
    notes: [
      "Comparisons (eq, ifEq, lt, gt) on an empty field fail the template and skip the send for that person; wrap the field in defaultIfEmpty.",
      "When an event field and a profile field share a name, the event wins; use {{profile.field}} for the profile value.",
      "Event fields are only available when that event triggered the campaign or journey.",
      "Use {{{triple braces}}} for snippets and fields that contain HTML.",
    ],
    docs: [`${S}/205480365-Personalizing-Templates-with-Handlebars`, `${S}/115003884806-Handlebars-Reference-Conditional-Logic-Helpers`],
  },
  channels: {
    push: {
      notes: [
        "Iterable gives no hard push length limit; its FAQ warns text may be truncated beyond a few lines.",
        "Push action buttons don't support Handlebars or snippets.",
        "Use https for Open URL; iOS won't open http.",
      ],
      docs: [`${S}/360044425971-Creating-Push-Notification-Templates`, `${S}/360035624191-Mobile-Frequently-Asked-Questions`],
    },
    sms: {
      notes: [
        "By default Iterable appends \"Msg&data rates may apply. Text 'STOP' to quit.\" (48 characters, billed) to every text; it's set in Settings > Project Settings, and changing it affects all unsent campaigns, including live triggered and journey ones.",
        "Quiet Hours are on by default for SMS (8 PM–9 AM recipient time).",
        "UTMs are only added to shortened, tracked links.",
      ],
      docs: [`${S}/15521924837908-Customizing-SMS-Opt-Out-Instructions`, `${S}/360044426031-Creating-SMS-Templates`],
    },
    "in-app": {
      notes: ["In-app messages expire after 90 days by default; changing the expiry after sending doesn't affect people who already got it.", "The mobile inbox cuts titles at 25 characters and body text at 75."],
      docs: [`${S}/360044425951-Creating-In-App-Templates`],
    },
    email: {
      notes: ["Keep emails under ~100 KB; snippets and tracked links count toward size, and link shortening helps."],
      docs: [`${S}/205480215-Maximizing-Email-Deliverability`],
    },
  },
  tasks: {
    "create-campaign": {
      steps: [
        "Messaging > Campaigns > New Campaign, then choose the medium.",
        "Name it, add labels, choose Blast, and select Create Campaign.",
        "Audience: Select lists, then pick send lists and suppression lists.",
        "Content: Browse Templates and pick one; the campaign gets its own copy.",
        "Delivery and Compliance: quiet hours, Send Time Optimization, frequency-cap override if needed.",
        "Schedule (up to 21 days ahead) in project or recipient time zone, or send now.",
      ],
      gotchas: [
        "Campaigns created through the API don't get global suppression lists automatically.",
        "Send Time Optimization can't be combined with recipient-time-zone sending; Quiet Hours override STO.",
        "A scheduled list sends to its membership as of its last refresh.",
      ],
      docs: [`${S}/15706398096788-Choosing-an-Audience-for-a-Blast-Campaign`, `${S}/14761834767508-Sending-or-Scheduling-a-Blast-Campaign`],
    },
    "create-journey": {
      steps: [
        "From the Journeys page, create a journey; it opens in Studio.",
        "Double-click the Start tile and choose one entry source (Event Occurs, Schedule, API call, Subscribe to List…).",
        "Add entry rules and Maximum Entries; use Exclude from Journey for suppression lists.",
        "Add Time Delay tiles; put a short delay before any tile that checks profile fields that may not have updated yet.",
        "Add Yes/No Split or Attribute Split tiles and use Preview results to check routing.",
        "Add message tiles; set quiet hours, STO, Ignore Frequency Cap and experiments in each tile's settings.",
        "Save, then Publish.",
      ],
      gotchas: [
        "In an Attribute Split, unchecking 'Everyone else' removes people who don't match.",
        "Subscribe to List doesn't enroll people who were already on the list.",
        "A Loop tile with an unconnected Loop Back path blocks publishing.",
      ],
      docs: [`${S}/4405783163284-Tutorial-Build-Your-First-Journey`, `${S}/7961818099092-Defining-How-Users-Enter-Journeys`],
    },
    "edit-live-journey": {
      steps: [
        "In Studio, select Edit journey to create a draft (one draft per journey).",
        "Make the changes; Reset draft discards them.",
        "Publish to replace the live version.",
        "To roll back: three-dot menu > Version history > Restore as draft, then publish.",
      ],
      gotchas: [
        "People already in the journey move to the new version after their current step.",
        "People in deleted tiles exit, except those in a deleted Time Delay, who stay until it ends.",
        "Version history doesn't record campaign or template edits.",
      ],
      docs: [`${S}/18346367178644-Editing-Journeys`, `${S}/10040142041876-Managing-Journeys`],
    },
    "edit-live-message": {
      steps: [
        "Open the campaign (for a journey message, open the message tile's campaign; no republish needed).",
        "Edit the template, preview with a real user's data, and send a proof to your internal list.",
        "Save. The change applies to future sends immediately.",
      ],
      gotchas: [
        "Edits to a journey's campaign go live immediately, without publishing the journey.",
        "Editing the base template in Content > Templates doesn't change campaigns already made from it; each campaign has a copy.",
        "Template edits aren't in version history; keep your own record.",
      ],
      docs: [`${S}/12649121962260-Message-Tiles`, `${S}/6532713719572-Working-With-Templates`],
    },
    "edit-shared-content": {
      steps: [
        "Content > Snippets: open the snippet.",
        "Safer route: Save As New, edit the copy, test it in a copied template, then apply the change to the original.",
        "Save Snippet (there's no auto-save).",
      ],
      gotchas: [
        "Saving a snippet changes every template and campaign that uses it immediately, including running ones.",
        "Snippet variables are positional and required; changing their order or count can break existing uses.",
        "Snippet names can't be changed after saving.",
      ],
      docs: [`${S}/46135873895956-Creating-and-Managing-Snippets`, `${S}/4414807441556-Snippets-Overview`],
    },
    "change-audience": {
      steps: [
        "Audience > Lists: open the list and check its Referenced In tab for live campaigns first.",
        "Dynamic lists: edit the query and Update List (re-evaluated at send time). Static lists: update via CSV import.",
        "Suppression: create a list of type Suppression; Enable Global applies it to campaigns and journeys created afterwards.",
        "Blast campaign: change send and suppression lists in the campaign's Audience section.",
        "Journey: change the Start tile's entry rules and exclusions in a draft, then publish.",
      ],
      gotchas: [
        "Enable Global doesn't apply to campaigns and journeys created before it was turned on.",
        "Scheduled lists refresh every 24 hours.",
      ],
      docs: [`${S}/204780549-Lists-Overview`, `${S}/15934993720468-Start-Tile`],
    },
    "link-tracking": {
      steps: [
        "Template Details: set the Google Analytics campaign name (utm_campaign). utm_source=Iterable and utm_medium are fixed.",
        "Add any other parameters as Link Parameters (Handlebars allowed, e.g. campaignId={{campaignId}}).",
        "SMS: turn on link shortening; UTMs only apply to shortened, tracked links.",
      ],
      gotchas: ["Push templates have no link parameters.", "There's no project-wide UTM default; set it per template."],
      docs: [`${S}/212082423-Google-Analytics-Iterable-Integration`, `${S}/4403865896724-Link-Shortening-and-Click-Tracking-for-RCS-SMS-and-WhatsApp`],
    },
    "frequency-and-quiet-hours": {
      steps: [
        "Frequency Management (needs Manage Settings): caps per channel and per message type, 1–99 per day, week or month.",
        "Per campaign or journey tile: Ignore Frequency Cap if this send shouldn't count.",
        "Quiet Hours: the campaign's Delivery and Compliance section, or the journey message tile's Use quiet hours.",
      ],
      gotchas: [
        "Caps are per channel, never one cross-channel cap; transactional message types are exempt.",
        "Capped users in a journey skip the send and keep going.",
        "Quiet Hours use the profile's timeZone; decide what happens when it's missing.",
      ],
      docs: [`${S}/15342990564372-Frequency-Management`, `${S}/16928857601940-Quiet-Hours`],
    },
    "conversion-tracking": {
      steps: [
        "Set the campaign or journey's conversion event; for purchases choose iterable_purchase.",
        "Send purchases through the commerce endpoint (a custom event named 'purchase' isn't a purchase).",
      ],
      gotchas: ["Since July 2024 new campaigns use time-based, last-touch attribution; older campaigns kept their old method."],
      docs: [`${S}/27303602165396-Campaign-Attribution`, `${S}/205480285-Tracking-Conversions-Purchases-and-Revenue`],
    },
    "ab-test": {
      steps: [
        "Campaign: create an experiment (subject, preheader, sender, body, send time or whole message).",
        "Pick the winner metric (opens, clicks or a custom conversion).",
        "Journey content test: message tile > Experiment > create A/B experiment. Path test: an A/B Split tile (up to 10 branches).",
      ],
      gotchas: [
        "In triggered and journey campaigns the current leader gets 90% of sends once each variant has enough sends.",
        "Holdout groups are for blast campaigns only.",
      ],
      docs: [`${S}/22872099556116-Configuring-Experiments`, `${S}/15906178005524-Experiment-Winner-Selection`],
    },
    "test-and-preview": {
      steps: [
        "Preview: load a user's profile to render the template.",
        "Send a test to yourself, to an internal list (Iterable's seed list), or as random users from a list.",
      ],
      gotchas: ["Push and in-app tests need an active device on the test profile; they're capped at 50 users.", "Unsubscribe and view-in-browser links don't behave like the real ones in tests."],
      docs: [`${S}/360044426191-Sending-Test-Messages`],
    },
    "pause-stop-duplicate": {
      steps: [
        "Blast sending now: Abort Campaign. Scheduled blast: cancel or archive it.",
        "Triggered campaign: Deactivate Campaign on its review page.",
        "Journey: to stop new entries but let current users finish, disconnect the Start tile; turning the journey off removes current users after their current step.",
        "Copy a campaign or journey from its list page.",
      ],
      gotchas: ["Journeys can't be deleted, only archived.", "A copied campaign is never scheduled or activated automatically."],
      docs: [`${S}/14825326846356-Managing-Your-Campaigns`, `${S}/10040142041876-Managing-Journeys`],
    },
  },
  unverified: [
    "Exact menu path to Journeys (the support site blocks automated reading; labels come from search excerpts).",
    "Whether editing a dynamic list's criteria affects people already in a journey.",
    "Mobile push length limits (Iterable documents none).",
  ],
};
