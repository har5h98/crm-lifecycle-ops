---
name: edit-plan
description: Step-by-step, platform-specific instructions for changing something that already exists. Edit live copy, change a journey that's running, swap a shared content block, change the audience or exclusions, add tracking, set frequency caps, add an A/B test, pause or duplicate. Written in the platform's own terms, filled in with the team's house rules, and showing what else the change affects. Use when someone asks "how do I change…", "how do I edit the live…", "what's the safest way to update…", "how do I add an exclusion to…".
argument-hint: "<what you want to change, and in which campaign or journey>"
---

# Edit plan

The plugin never edits the account itself; it tells the operator exactly how to, safely.

1. Work out:
   - **platform** (connected one, or ask);
   - **target**: the campaign or journey (resolve names with `list_items`);
   - **task**, one of: `edit-live-message` · `edit-live-journey` · `edit-shared-content` · `change-audience` ·
     `link-tracking` · `frequency-and-quiet-hours` · `conversion-tracking` · `ab-test` · `test-and-preview` ·
     `pause-stop-duplicate`. A request can need two (e.g. new copy *and* a new exclusion): call once per task.
   - **channels** involved and any **attributes** the new copy will use.
2. Make sure the snapshot is fresh (offer `/refresh` if it's over a day old). Edits to live programs
   need current data.
3. Call `how_to` with platform, task, target, channels, attributes.
4. Write it up in this order:
   - **Before you start**: every item in `warnings` (live status, shared blocks that would change other
     live programs). If the change touches a segment, attribute or block, also run `what_breaks` and summarize.
   - **Steps**: numbered, in the platform's own words. Weave in the team's specifics from `yourSetup`
     (exact UTM parameters, fallback syntax, sender, limits) where they apply, rather than listing them separately.
   - **Watch out for**: the `gotchas`, especially what happens to people already mid-journey or to scheduled sends.
   - **After the change**: `afterwards` (re-QA with `/check-campaign`, tests, `/watch-launch`).
   - **Sources**: the `docs` links, and "procedures verified on <verifiedAt>". If anything relevant is in
     `unverified`, say so plainly.
5. If they paste the new copy, run `check_email` / `check_message` on it before they make the change.
