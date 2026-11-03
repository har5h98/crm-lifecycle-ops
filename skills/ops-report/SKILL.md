---
name: ops-report
description: Report on how the crm-lifecycle-ops QA tools are being used and what they caught, for one operator or the whole team. Messages checked, blocking problems caught, most common issues, weekly trend and estimated hours saved. Use when someone asks "what has this caught", "how much time are we saving", "ops report", or needs numbers for a manager.
argument-hint: "[days] [team]"
---

# Ops report

1. `ops_report` (default 30 days; pass `minutes_per_manual_check` if they know their manual QA time per message).
   For a team view ("team", "everyone", "for my manager"), pass `team: true`. That needs a shared team folder set
   in `/plugin configure crm-lifecycle-ops`; if it isn't set, explain that each operator points it at the same
   synced drive folder, and that only counts and check ids are shared, never message content.
2. Present it as a short manager-ready summary:
   - headline: "**N** messages checked, **M** blocking problems caught before send, about **H** hours saved";
   - the weekly trend (a small table);
   - the most common findings, translated into plain words, and what they suggest (e.g. lots of UTM
     misses → add UTMs to the template or tighten the house rule);
   - the time-saved assumption, stated plainly.
3. Data comes from usage logs: counts and check ids, never message content. The personal report reads this
   machine only; the team report reads every operator's mirrored log in the shared folder and adds a per-operator
   breakdown (`byOperator`). Present it as adoption, not as a scoreboard.
