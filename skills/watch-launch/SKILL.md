---
name: watch-launch
description: Health check on a campaign or journey after it goes out. Bounce, unsubscribe, spam-complaint and delivery rates against stated thresholds, plus stalls. Use when someone says "how's the launch", "is the send healthy", "check deliverability on…", or an hour after launching.
argument-hint: "<campaign or journey name>"
---

# Watch a launch

1. Needs a connected account and a recent snapshot (the demo has no delivery data).
2. `launch_health` with the name. Report:
   - **Verdict**: 🟢 healthy · 🟡 watch · 🔴 act now · ⚪ no data.
   - Sent and delivered, then rates (bounce, unsubscribe, spam, open, click), each next to its threshold.
   - Any notes about what the platform doesn't report.
3. If it's 🔴: what to do now (pause and check the list source for bounces, review targeting and frequency
   for unsubscribes, check consent/source and pause for spam) and who to tell.
   If ⚪ and it should be sending: check it's switched on, the schedule, and the audience size.
4. Offer to run again later (e.g. `/loop 1h /watch-launch <name>` or `/schedule`).

Thresholds are common industry rules of thumb, not platform limits; they're in the result. Say so if asked.
