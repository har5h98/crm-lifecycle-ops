import type { PlatformGuide } from "./types.js";

// Verified against help.klaviyo.com and the 2026-10-15 API spec on 2026-11-02.
const H = "https://help.klaviyo.com/hc/en-us/articles";

export const klaviyo: PlatformGuide = {
  platform: "klaviyo",
  verifiedAt: "2026-11-02",
  terms: { journey: "Flow", campaign: "Campaign", segment: "Segment", list: "List", sharedContent: "Universal content", testUsers: "internal list" },
  personalization: {
    attribute: (n) => `{{ ${n} }}`,
    customAttribute: (n) => (/^[a-z_][a-z0-9_]*$/i.test(n) ? `{{ person.${n} }}` : `{{ person|lookup:'${n}' }}`),
    withFallback: (n, fb, custom) => (custom ? `{{ person|lookup:'${n}'|default:'${fb}' }}` : `{{ ${n}|default:'${fb}' }}`),
    conditional: (n) => `{% if person|lookup:'${n}' %}…{% else %}…{% endif %}`,
    notes: [
      "Tags are case sensitive; use person|lookup:'Name' for properties with spaces.",
      "Event variables ({{ event.X }}) only work in flows triggered by that event, not in campaigns, and previews sent as campaigns have no event data.",
      "A catalog lookup for a missing item skips the whole message.",
    ],
    docs: [`${H}/115005084927`, "https://developers.klaviyo.com/en/docs/django_message_design"],
  },
  channels: {
    push: {
      notes: ["Title up to 255 and body up to 512 characters; lock screens show far less, so keep the point up front.", "Deep links must be set up in the app before you use them."],
      docs: [`${H}/360006653972`],
    },
    sms: {
      notes: [
        "Up to 1,600 characters; each 160 (or 70 with emoji/special characters) is a billed segment.",
        "Opt-out language and the company prefix are add-ons set in Settings > Text message and toggled per message in the Compliance panel; the opt-out text must contain STOP. Leave it on.",
        "Keep 'Automatically shorten links' on: SMS UTMs and click tracking need it.",
        "Default quiet hours: 8 p.m.–11 a.m. recipient time.",
      ],
      docs: [`${H}/360035661191`, `${H}/360040039971`, `${H}/360035285472`],
    },
    "in-app": {
      notes: ["Klaviyo has no in-app message channel; the equivalent is in-app forms (Sign-up forms with the In-app badge), which can't collect consent or profile data."],
      docs: [`${H}/34603509978907`],
    },
    email: { notes: ["Event personalization isn't available in campaigns, only in flows triggered by that event."], docs: [`${H}/18986347580827`] },
  },
  tasks: {
    "create-campaign": {
      steps: [
        "Campaigns > Create campaign; name it and add tags.",
        "Choose Single channel (Email, Text message or Push) or Omnichannel (up to 10 audience paths, 30 messages).",
        "Recipients: Send to (up to 25 lists/segments) and Don't send to for exclusions; Smart Sending is a toggle here.",
        "Tracking > Include tracking parameters for UTMs (or the message's Settings tab in Omnichannel).",
        "Message: subject, sender name and email, content; for SMS keep link shortening and the Compliance panel on.",
        "Preview (or Preview & test for push) with a real profile and send a test.",
        "Schedule or send: send now, or schedule with a strategy, date, time and time zone.",
      ],
      gotchas: [
        "Smart Sending is on by default (email 16h, SMS and push 24h) and silently skips people who got a message recently.",
        "Smart Send Time is email-only.",
        "Without 'Determine recipients at send time', the audience is fixed when you schedule.",
        "A campaign with 0 recipients is cancelled automatically.",
      ],
      docs: [`${H}/115005054847`, `${H}/360040039971`, `${H}/40939669530011`],
    },
    "create-journey": {
      steps: [
        "Flows > Create flow > Build your own; name it.",
        "Choose the trigger (list, segment, metric, date property, price drop or low inventory) and set Re-entry criteria.",
        "Add Trigger filters (checked once, at entry) and Profile filters (re-checked before every step).",
        "Add steps: emails, texts, push, time delays and conditional/trigger splits (YES/NO paths).",
        "Put a time delay before any split that depends on what people do after entering.",
        "Per message: Smart Sending, UTM tracking, quiet hours and additional filters in the details panel.",
        "Review and turn on > Live > Update status now > Save.",
      ],
      gotchas: [
        "The trigger can't be changed once set; clone the flow to use a different one.",
        "Trigger filters aren't re-checked at send time; profile filters are.",
        "A time delay must be followed directly by a live or manual action.",
        "Engagement metrics such as Opened Email can't be triggers.",
      ],
      docs: [`${H}/115002774932`, `${H}/115002779051`, `${H}/360003040052`],
    },
    "edit-live-journey": {
      steps: [
        "To hold sends while you work, set the affected messages to Manual (queued people wait in Needs Review).",
        "Edit messages, delays or splits in the flow builder.",
        "Set messages back to Live, then decide what to do with anyone in Needs Review.",
      ],
      gotchas: [
        "Switching Manual back to Live does NOT release Needs Review; send or discard those people yourself.",
        "Changing a time delay doesn't reschedule people already waiting.",
        "Deleting a message makes waiting people skip to the next step and can't be undone; set it to Draft instead.",
        "The trigger can't be changed; clone the flow instead.",
      ],
      docs: [`${H}/115002779271`, `${H}/360048376172`],
    },
    "edit-live-message": {
      steps: [
        "Flow message: open it and edit; messages can be edited whatever their status, without pausing.",
        "Scheduled campaign: Campaigns > three-dot menu > Revert to draft, edit, then Schedule or send > Schedule message again.",
        "Preview with a real profile and send a test before saving.",
      ],
      gotchas: [
        "Within 15 minutes of the send, a scheduled campaign can't be reverted; cancel and clone it instead.",
        "If you revert to draft and don't reschedule, the campaign won't send.",
        "Pause the campaign before changing its UTMs.",
        "Klaviyo doesn't document whether edits reach people already waiting in a flow; assume they may.",
      ],
      docs: [`${H}/4411545074203`, `${H}/115002779271`],
    },
    "edit-shared-content": {
      steps: [
        "Content > Universal content: check Content usage to see where the block appears.",
        "Three-dot menu > Edit, make the change, then Save & publish.",
        "To change one email only, open it and choose Unlink and edit independently.",
      ],
      gotchas: [
        "Publishing updates every linked instance at once, including scheduled campaigns and live flows.",
        "Marking a flow email transactional silently unlinks its universal blocks.",
        "Deleting universal content can't be undone.",
      ],
      docs: [`${H}/115005413888`],
    },
    "change-audience": {
      steps: [
        "Campaign: change Send to / Don't send to on the Recipients step (revert a scheduled campaign to draft first).",
        "Omnichannel: a path's audience can only change while all its messages are drafts.",
        "Flow: segment- or list-triggered flows follow the segment; change the segment definition in Audience > Lists & segments.",
        "To bring people who already qualify into a flow, use Add past profiles.",
      ],
      gotchas: [
        "Editing a segment's definition doesn't trigger the flow for people who already qualified.",
        "Flow recipients must still be in the segment at send time to get each message.",
      ],
      docs: [`${H}/360003040052`, `${H}/115005054847`],
    },
    "link-tracking": {
      steps: [
        "Account default: Settings > Other > UTM tracking > Automatically add UTM parameters to links (utm_source and utm_medium required).",
        "Campaign: Recipients > Tracking > Include tracking parameters, with Customize tracking parameters if needed.",
        "Flow message: Settings > Enable UTM Tracking, plus Use custom tracking parameters.",
        "SMS: keep link shortening on, or UTMs and clicks won't be tracked.",
      ],
      gotchas: ["Changing the account default updates messages that still use it; custom ones are untouched.", "Links must start with http:// or https:// to be tracked."],
      docs: [`${H}/360053921252`],
    },
    "frequency-and-quiet-hours": {
      steps: [
        "Smart Sending windows: Settings > Email / SMS / Push notifications > Sender preferences.",
        "Turn Smart Sending on or off per campaign (Recipients step) or per flow message.",
        "SMS quiet hours: account settings; per flow message, Enable text message quiet hours; per campaign, delay or skip.",
        "Throttle a campaign with a gradual send (1–50% per hour or minute).",
      ],
      gotchas: [
        "Each channel has its own Smart Sending window, and transactional messages ignore it.",
        "In flows, quiet hours are checked before Smart Sending; a message can end up skipped.",
      ],
      docs: [`${H}/115002779311`, `${H}/4408737146651`],
    },
    "conversion-tracking": {
      steps: [
        "Campaigns: pick the conversion metric from the list view's dropdown (Customize columns if hidden).",
        "Flows: message > Performance > View details > Conversion metric.",
      ],
      gotchas: ["The choice is saved per user, not for the whole account; agree on one with your team."],
      docs: [`${H}/115005199947`],
    },
    "ab-test": {
      steps: [
        "Campaign: Create A/B test above the subject line; test content or send times; pick open, click or placed-order rate.",
        "Set the test size; at 100% there's no winner send.",
        "Flow email: Create A/B test in the details panel, clone variations, set weights and winner rules, Publish Test.",
      ],
      gotchas: [
        "Variations can't be added or removed once a flow test is live.",
        "Apple Mail Privacy Protection inflates open-rate winners; prefer clicks or orders.",
        "SMS A/B tests are documented for campaigns; for flow texts Klaviyo suggests splits.",
      ],
      docs: [`${H}/115005228148`, `${H}/6960371049115`],
    },
    "test-and-preview": {
      steps: [
        "Preview: choose a profile with Search profiles (or step through events for event-triggered flows).",
        "Send test to comma-separated addresses; recipients see the chosen profile's data.",
        "Push: Preview & test.",
      ],
      gotchas: ["Unsubscribe and web-view links are placeholders in tests.", "Tests count toward a monthly preview limit (100 on the free plan)."],
      docs: [`${H}/115005081907`],
    },
    "pause-stop-duplicate": {
      steps: [
        "Flow: Update status > Draft (stops new entries) or Manual (queues everyone in Needs Review) > Update status now > Save.",
        "Campaign: three-dot menu > Cancel > Cancel campaign (can't be undone).",
        "Clone: three-dot menu > Clone; cloned messages start as drafts.",
      ],
      gotchas: ["There's no pause button for flows; status is the pause.", "Messages already processing may still send after cancelling."],
      docs: [`${H}/360048376172`, `${H}/115005085067`, `${H}/24898429283739`],
    },
  },
  unverified: [
    "Whether content edits reach people already waiting in a live flow.",
    "Whether flow SMS and push A/B tests are available in the UI (the API allows them).",
    "Whether opt-out and prefix add-ons are on by default for every marketing text.",
  ],
};
