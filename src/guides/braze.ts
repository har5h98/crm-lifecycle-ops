import type { PlatformGuide } from "./types.js";

// Verified against braze.com/docs on 2026-11-02. Braze moved its docs to /user_guide/channels/… and
// /user_guide/messaging/…; links below are the current ones.
const D = "https://www.braze.com/docs/user_guide";

export const braze: PlatformGuide = {
  platform: "braze",
  verifiedAt: "2026-11-02",
  terms: { journey: "Canvas", campaign: "Campaign", segment: "Segment", list: "Segment", sharedContent: "Content Block", testUsers: "Content Test Group" },
  personalization: {
    attribute: (n) => `{{\${${n}}}}`,
    customAttribute: (n) => `{{custom_attribute.\${${n}}}}`,
    withFallback: (n, fb, custom) => (custom ? `{{custom_attribute.\${${n}} | default: '${fb}'}}` : `{{\${${n}} | default: '${fb}'}}`),
    conditional: (n) => `{% if \${${n}} != blank %}…{% else %}…{% endif %}`,
    notes: [
      "default only covers empty or missing values, not whitespace (\" \"); use a blank check for those.",
      "Filters don't work inside if/elsif; assign the filtered value to a variable first.",
      "In a Canvas, an aborted Message step doesn't exit the user; they continue to the next step.",
      "In-app message Liquid and abort logic run on the device when the message triggers, not at send.",
    ],
    docs: [`${D}/messaging/design_and_edit/personalize/liquid/setting_default_values`, `${D}/messaging/design_and_edit/personalize/liquid/aborting_messages`],
  },
  channels: {
    push: {
      notes: [
        "Braze suggests ~30–40 characters per line; the composer's counter ignores rendered Liquid, so preview as a user with a long name.",
        "Android push can't be sent without a title. iOS titles hide everything after a line break (use | strip_newlines).",
        "Image URLs from Liquid must be https.",
      ],
      docs: [`${D}/channels/push/best_practices`, `${D}/channels/push/create_a_push_message/message_and_image_formats`],
    },
    sms: {
      notes: [
        "Braze rejects texts over 10 segments (1,530 GSM-7 / 670 Unicode characters). The segment calculator doesn't render Liquid; preview as a user.",
        "Braze doesn't add opt-out text for you; compliance wording is the sender's responsibility.",
        "Link shortening: tick it per variant; save before test-sending, and shortened links last 9 weeks.",
      ],
      docs: [`${D}/channels/sms_mms_and_rcs/billing_calculator`, `${D}/channels/sms_mms_and_rcs/compliance_and_delivery/best_practices`],
    },
    "in-app": {
      notes: ["In-app messages can't be part of a multichannel campaign; use a single-channel campaign or a Canvas.", "Changes reach devices at their next session start."],
      docs: [`${D}/channels/in_app_messages/message_types/modal`],
    },
    email: {
      notes: ["Gmail clips bodies over ~102 KB; Braze can't save a body over 400 KB and adds a few KB for tracking."],
      docs: [`${D}/channels/email/best_practices/email_styling`],
    },
  },
  tasks: {
    "create-campaign": {
      steps: [
        "Messaging > Campaigns > Create campaign, then pick the channel (or Multichannel).",
        "Name it; add Description, Teams and Tags.",
        "Compose the message (for SMS, choose the Subscription Group first). Add variants if testing.",
        "Schedule Delivery: Scheduled, Action-based or API-triggered; set re-eligibility and frequency capping here.",
        "Target Audiences: segments and Additional Filters, subscription status, rate limit, control group.",
        "Assign Conversions: up to 4 events, deadline up to 30 days. The first is the primary.",
        "Preview and Test: preview as a user and send tests to your Content Test Group.",
        "Review the summary, then Launch Campaign.",
      ],
      gotchas: [
        "Conversion events can't be added or removed after launch. Get them right now.",
        "Local-time sends must be scheduled 24h ahead (Intelligent Timing 48h).",
        "The audience is evaluated at send time, not at launch.",
        "In-app messages can't go in a multichannel campaign.",
      ],
      docs: [`${D}/messaging/campaigns/creating_campaign`, `${D}/messaging/campaigns/schedule_your_campaign/scheduled_delivery`],
    },
    "create-journey": {
      steps: [
        "Messaging > Canvas > Create Canvas; set name, Teams, Tags and conversion events.",
        "Entry schedule: Scheduled, Action-based or API-triggered.",
        "Target Audience: entry segments and filters, re-entry and max entries, exit criteria.",
        "Send Settings: subscription settings, rate limit, frequency capping, Enable Quiet Hours.",
        "Build the path with Message, Delay, Audience Paths (first match wins; 'Everybody Else' last) and Decision Split steps.",
        "Add a Delay before any split that depends on engagement with the previous message.",
        "Test Canvas (footer) to preview a user's path, then Launch Canvas.",
      ],
      gotchas: [
        "Audience Paths and Decision Splits evaluate the moment a user arrives; nobody is re-evaluated later on that path.",
        "Use 'Validate audience at message send' on Message steps if profiles can change during a delay.",
        "A path with no next step exits the user.",
        "Conversion events and the order of Audience Paths can't be changed after launch.",
      ],
      docs: [`${D}/messaging/canvas/create_a_canvas`, `${D}/messaging/canvas/canvas_components/audience_paths`, `${D}/messaging/canvas/canvas_components/decision_split`],
    },
    "edit-live-journey": {
      steps: [
        "Open the active Canvas and make the edit.",
        "Select Save as Draft to stage a post-launch draft (one draft at a time; switch with View Active Canvas / Edit Draft).",
        "QA the draft: preview as users and re-run checks.",
        "Update the Canvas to apply the draft, or discard it.",
      ],
      gotchas: [
        "Can't change after launch: conversion events; adding, removing or reordering Audience Paths, Action Paths or Experiment Paths steps. Workaround: add a new step, or duplicate the Canvas.",
        "Users already queued for a Message step may not get the edit; users in a Delay keep their original delay.",
        "Any update ends a running Winning Path / Personalized Paths experiment, even if you didn't touch that step.",
        "Stopping the Canvas discards the draft.",
        "For big changes Braze recommends: stop, duplicate, edit the copy, launch it, and exclude people who got the original.",
      ],
      docs: [`${D}/messaging/canvas/managing_canvases/change_your_canvas_after_launch`, `${D}/messaging/canvas/managing_canvases/canvas_drafts`],
    },
    "edit-live-message": {
      steps: [
        "Open the campaign's details page and select Stop Campaign first (recommended).",
        "Edit the message, or use Save as Draft for bigger changes.",
        "QA the change: Preview and Test as several users.",
        "Save or launch the draft, then Resume. Messages missed while stopped aren't re-sent.",
      ],
      gotchas: [
        "Editing a running campaign without stopping it can re-enqueue people and send twice.",
        "Changing a campaign whose A/B test has started invalidates the experiment and removes its results.",
        "In-app changes reach devices only at their next session; turn on 'Re-evaluate campaign eligibility before displaying'.",
        "For a message inside a Canvas, use the Canvas draft flow instead (edit-live-journey).",
      ],
      docs: [`${D}/messaging/campaigns/manage_campaigns/change_your_campaign_after_launch`],
    },
    "edit-shared-content": {
      steps: [
        "Content > Content Block, then open the block (check its inclusion count first).",
        "To be safe, More > Duplicate first; the duplicate saves as a draft you can test.",
        "Edit, then Launch Content Block to publish the change.",
      ],
      gotchas: [
        "The change reaches every message that includes the block through Liquid ({{content_blocks.${name}}}) immediately, including live ones.",
        "Blocks dragged in through the drag-and-drop Rows tab are copies and won't update.",
        "No version history and no undo, so duplicate before big changes. Block names can't be changed.",
        "A Canvas whose draft uses the block isn't in the inclusion list.",
      ],
      docs: [`${D}/messaging/design_and_edit/content_blocks`],
    },
    "change-audience": {
      steps: [
        "Campaign: Target Audiences > Target Users by Segment (multiple segments are ANDed) and Additional Filters.",
        "To exclude people, add a filter such as Segment Membership (negated) or 'Received Message from Campaign/Canvas'.",
        "Workspace-wide exclusions: Audience > Suppressions.",
        "Canvas: change the Entry Audience, or a Message step's audience and delivery validations.",
        "Check reach with Calculate exact statistics and spot-check users with User Lookup.",
      ],
      gotchas: [
        "Live campaign audience edits apply immediately; live Canvas entry-audience edits affect only future entries.",
        "Don't use the trigger event as an audience filter (race condition).",
        "Global Control Group users are left out of reachable counts.",
      ],
      docs: [`${D}/messaging/messaging_fundamentals/target_users`, `${D}/audience/suppression_lists`],
    },
    "link-tracking": {
      steps: [
        "Email link templates must be enabled by your Braze account manager; then Templates > Email Link appears.",
        "Create email link template, position After URL, e.g. utm_source=braze&utm_campaign={{campaign.${name} | url_encode}}.",
        "In the email: sidebar > Content > Link Management > Add a Link Template.",
        "SMS: there are no link templates; add UTMs to the URL yourself, then turn on link shortening for click tracking.",
      ],
      gotchas: [
        "Link templates are email-only and skip plain-text versions and links that only exist after Liquid renders.",
        "Test sends don't fill in {{${user_id}}}.",
        "In a Canvas, {{campaign.${name}}} returns the step name; use {{canvas.${name}}} for the Canvas.",
      ],
      docs: [`${D}/messaging/templates/email_templates/link_template`, `${D}/channels/sms_mms_and_rcs/message_features_and_optimization/link_shortening`],
    },
    "frequency-and-quiet-hours": {
      steps: [
        "Workspace caps: Settings > Frequency Capping Rules (per channel or tag, up to 10 rules, windows up to 30 days).",
        "Per campaign: the Frequency Capping toggle in Schedule Delivery (on by default).",
        "Rate limit: campaign Target Audiences, or Canvas Send Settings (per minute).",
        "Quiet hours: Canvas Send Settings > Enable Quiet Hours (user local time; abort or send at next available time).",
      ],
      gotchas: [
        "Caps use the user's local calendar day, not a rolling 24 hours.",
        "In-app messages and Content Cards don't count toward caps.",
        "Messages delayed 72h+ by a low rate limit are aborted.",
        "Quiet hours don't re-check segment membership; held sends go out together when the window ends.",
      ],
      docs: [`${D}/messaging/messaging_fundamentals/frequency_capping`, `${D}/messaging/messaging_fundamentals/quiet_hours`],
    },
    "conversion-tracking": {
      steps: [
        "Campaign: the Assign Conversions step (up to 4). Canvas: set them when creating the Canvas.",
        "Pick a type (e.g. Makes Purchase, Performs Custom Event) and a deadline (up to 30 days).",
        "Put the outcome you care about first; the primary event drives winners and optimization.",
      ],
      gotchas: ["Conversion events can't be changed after launch. To change them, duplicate the campaign or Canvas.", "The default is Starts Session within 3 days."],
      docs: [`${D}/messaging/messaging_fundamentals/conversion_events`],
    },
    "ab-test": {
      steps: [
        "Campaign: use a single-channel campaign; compose up to 8 variants.",
        "Target Audiences: set the variant split and an optional control group; optionally Optimize with BrazeAI.",
        "Set the conversion event, then launch.",
        "Canvas: add an Experiment Paths step (up to 4 paths plus control, totalling 100%), optionally with Winning Path.",
      ],
      gotchas: [
        "Editing the campaign after the test starts disables the experiment; avoid edits in the first hour.",
        "Experiment Paths can't be removed after creation, and any Canvas update ends a running Winning Path.",
        "Aim for about 15k users per variant for 95% confidence.",
      ],
      docs: [`${D}/messaging/ab_testing/create_tests`, `${D}/messaging/canvas/canvas_components/experiment_step`],
    },
    "test-and-preview": {
      steps: [
        "Settings > Internal Groups: create a Content Test Group (all channels) or Seed Group (email).",
        "In the composer: Preview and Test > Preview message as user (random, existing or custom user).",
        "Test Send: add your Content Test Group, then Send Test. Tick 'Override recipients' attributes' to render as the preview user.",
        "Canvas: Test Canvas in the footer previews a user's path.",
      ],
      gotchas: [
        "In-app and Content Card tests need a push-enabled test device.",
        "Abort logic can silently block a test send.",
        "Test sends count toward SMS billing.",
      ],
      docs: [`${D}/messaging/messaging_fundamentals/sending_test_messages`, `${D}/messaging/design_and_edit/personalize/preview_personalization`],
    },
    "pause-stop-duplicate": {
      steps: [
        "Campaign: details page > Stop Campaign; resume from the campaign menu > Resume.",
        "Canvas: stop it, then Resume Canvas from the Summary step.",
        "Duplicate: Messaging > Campaigns (or Canvas) > row > More actions > Duplicate.",
      ],
      gotchas: [
        "Stopping cancels scheduled messages and in-flight A/B tests; missed messages aren't re-sent on resume.",
        "Stopping a Canvas discards its draft.",
        "A duplicate resets eligibility, so filter out people who got the original.",
      ],
      docs: [`${D}/messaging/campaigns/manage_campaigns/change_your_campaign_after_launch`, `${D}/messaging/governance/duplicating`],
    },
  },
  unverified: [
    "Whether quiet hours are available on scheduled (not action-based) campaigns in the current UI.",
    "The exact wording of the segment-exclusion filter.",
    "Whether a push A/B test can target iOS and Android together (Braze's docs disagree).",
  ],
};
