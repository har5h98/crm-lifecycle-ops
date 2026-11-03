---
name: refresh
description: Pull the latest campaigns, journeys, segments, templates and content blocks from Braze, Klaviyo or Iterable into a local snapshot, and say what changed since last time. Use when someone asks to refresh, sync or pull the latest from their Braze, Klaviyo or Iterable account, or before impact or QA work on a connected account. Also loads the demo account. Not for git or code.
argument-hint: "[braze | klaviyo | iterable | demo]"
---

# Refresh

1. Pick the platform: what they said, else the connected one (`connection_status`), else ask.
   "demo", or nothing connected and they just want to try it → `refresh_account` with `platform: braze, demo: true`
   and say it's a fictional brand (Fernbrook Market).
2. Call `refresh_account`. It only reads, and on later runs it re-fetches only what changed.
3. Report briefly:
   - counts (live campaigns, live journeys, messages, segments/lists, content blocks);
   - **what changed since the last refresh**, live items first (or "first snapshot");
   - **gaps**: what the platform's API doesn't expose, verbatim. Don't bury these.
4. Suggest a next step that fits: `/check-campaign <name>`, `/what-breaks <thing>`, `/show-journey <name>`.

Tip to offer once: a daily refresh (via `/schedule` or a cron job) makes `/what-changed` catch
unannounced edits the next morning.
