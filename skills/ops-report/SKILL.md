---
name: ops-report
description: Report on how the QA and ops tools are being used and what they caught. Emails checked, blocking problems caught, most common issues, weekly trend and estimated hours saved. Use when someone asks "what has this caught", "how much time are we saving", "ops report", or needs numbers for a manager.
argument-hint: "[days]"
---

# Ops report

1. `ops_report` (default 30 days; pass `minutes_per_manual_check` if they know their manual QA time per email).
2. Present it as a short manager-ready summary:
   - headline: "**N** messages checked, **M** blocking problems caught before send, about **H** hours saved";
   - the weekly trend (a small table);
   - the most common findings, translated into plain words, and what they suggest (e.g. lots of UTM
     misses → add UTMs to the template or tighten the house rule);
   - the time-saved assumption, stated plainly.
3. Data comes from a local log on this machine only (counts and check ids, never email content).
   For a team-wide number, each person runs it and the totals are added.
