---
name: build-plan
description: Turn a campaign or journey brief into a step-by-step build checklist for the platform, reusing existing segments and content blocks, with QA and launch steps built in. Use when someone says "build plan", "turn this brief into a build", "what do I need to set up for…", "write the build spec".
argument-hint: "<brief, or the journey from /plan-journey>"
---

# Build plan

1. Get the brief (or use the journey from `/plan-journey` in this conversation).
2. If a snapshot exists, `list_items` to find **what can be reused** (segments, lists, content blocks such
   as footers) and name them in the plan instead of building new ones.
3. Write the checklist in build order, specific to their platform (Braze / Klaviyo / Iterable terms):
   1. Data & audience: attributes/events needed, segment or list (reuse or create, with the exact filters), exclusions.
   2. Content: each message with subject, preheader, sender, personalization **with fallbacks** (house
      fallback from `get_house_rules`), links with the team's UTM convention, content blocks to include.
   3. Orchestration: entry/trigger, waits, splits, exits, conversion event, frequency capping, quiet hours.
   4. QA: `/check-campaign <name>` once built; test sends to seed inboxes; check on mobile.
   5. Launch: who approves, launch time, `/watch-launch` at +1h and +24h.
4. Flag dependencies and risks: anything new that live programs might also touch (offer `/what-breaks`).
Keep it as a checkbox list someone can work through in the platform.
