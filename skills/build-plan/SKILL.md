---
name: build-plan
description: Turn a campaign or journey brief into a step-by-step build checklist for the platform, reusing existing segments and content blocks, with QA and launch steps built in. Use when someone says "build plan", "turn this brief into a build", "what do I need to set up for…", "write the build spec".
argument-hint: "<brief, or the journey from /plan-journey>"
---

# Build plan

Step-by-step instructions for building something new, specific to the platform and filled in with the
team's house rules and existing assets. The plugin never builds in the account itself.

1. Get the brief (or use the journey from `/plan-journey` in this conversation): goal, audience, trigger,
   channels, timing, offer, and the attributes the copy will personalize with.
2. Pick the task: `create-campaign` (one send or a scheduled/recurring send) or `create-journey` (multi-step).
   Call `how_to` with platform, task, channels, `audience` (in their words) and `attributes`. If the build also
   needs tracking, tests or caps set up, call `how_to` for `link-tracking`, `frequency-and-quiet-hours`,
   `conversion-tracking` or `ab-test` too.
3. If the audience or trigger is shared with live programs, run `find_overlaps` and add exclusions/priority
   rules to the plan.
4. Write a checklist someone can work through in the platform, in build order:
   1. **Audience & data**: reuse what `reuse` found (exact names), or the segment to create with its filters.
   2. **Content**: each message with subject/title, preheader, sender, the personalization snippets from
      `yourSetup` (platform syntax, team fallback), links with the team's UTM parameters, the footer block
      to insert, and channel limits (push length, SMS segments, in-app length).
   3. **Build steps**: the numbered `steps`, in the platform's own words.
   4. **Settings**: conversion event, frequency capping, quiet hours, tests.
   5. **QA & launch**: `afterwards`.
   6. **Watch out for**: `gotchas` and `warnings`.
   7. **Sources**: `docs`, "procedures verified on <verifiedAt>", and anything relevant from `unverified`.
5. Offer to QA the copy now with `/check-email`, `/check-push`, `/check-sms` or `/check-in-app` if they have drafts.
