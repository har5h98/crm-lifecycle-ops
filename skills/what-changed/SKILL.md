---
name: what-changed
description: What changed in the account since the last snapshot or a date. New, removed or paused campaigns and journeys, edited copy, audience and structure changes, live items first. Use when someone asks what changed in their Braze, Klaviyo or Iterable account (campaigns, journeys, segments, templates), who edited a campaign, or wants a morning check. Not for code or git diffs.
argument-hint: "[since date]"
---

# What changed?

1. If the latest snapshot is older than a few hours, run `refresh_account` first so the comparison is current.
2. `what_changed` (with `since` if they gave a date).
3. Report live items first, grouped: **went live / was stopped** · **copy edited** · **audience changed** ·
   **journey structure changed** · **added / removed** · segments and content blocks.
   For each live change, one line on why it might matter (e.g. "the footer block changed, which is in 4 live emails").
4. Offer the obvious follow-up: `/check-campaign` on anything edited and live, `/what-breaks` on a changed segment or block.
