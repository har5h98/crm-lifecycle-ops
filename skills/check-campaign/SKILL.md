---
name: check-campaign
description: QA a whole campaign or journey (Braze Canvas, Klaviyo flow, Iterable journey). Every message in it (emails with content blocks expanded, push, SMS, in-app), plus audience, conversion event, naming and journey structure (dead ends, unreachable steps), with an optional QA sign-off report. Use when someone says "check the welcome series", "QA this campaign", "is this Canvas ready", or wants a QA sign-off for a launch.
argument-hint: "<campaign or journey name>"
---

# Check a campaign or journey

1. Needs a snapshot. If there isn't one, run `/refresh` first (or offer the demo).
2. `check_campaign` with the name. If it returns `candidates`, ask which one (show the list).
3. Report:
   - **Verdict** (same scale as `/check-email`): 🔴 Don't launch · 🟡 Fix first · 🟢 Ready.
   - **Settings & structure**: audience, conversion event, naming, journey problems. Explain journey
     findings in plain terms ("people who reach *Clicked?* exit silently because neither path continues").
   - **Each message**: one line per message with its counts, then the findings that matter, worst first.
     Group the same finding across messages ("3 emails link to staging").
   - **What I couldn't check**, verbatim from `notVerified`.
   - **Waived by house rules**: a one-line count, expandable on request.
4. **Sign-off report.** Offer once: *"Want a sign-off report for the launch ticket?"* If yes (or if they asked
   for one up front, e.g. "QA and write it up"), call `save_sign_off_report` with the same name. Give
   the saved `path`, and say it's Markdown that pastes into Jira, Slack, Confluence or
   Notion with a reviewer sign-off at the end. Don't paste the whole report into chat unless asked.
5. If they disagree with a finding: fine for their team → `/house-rules`; tool is wrong → `/report-problem`.
