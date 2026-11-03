---
name: start-here
description: Overview of crm-lifecycle-ops. What each command does, what works today, and the best first step. Use when someone asks what crm-lifecycle-ops can do, how to use it, or which of its commands to run.
---

# Start here

Explain briefly, in this order, then suggest one next step that fits what they're doing.

**What it is:** the AI copilot for lifecycle and CRM operations on Braze, Klaviyo or Iterable. It helps at
every step of an operator's job: **plan and build faster**, **change safely** (know what a change breaks
before you make it), **send with confidence** (every message checked as every kind of customer), and
**prove the impact**. Read-only: it never sends anything and never edits the account.

**Commands** (✅ works · 🧪 works on the demo account and mocked APIs, not yet field-tested on real
accounts; keep this list in sync with the README):

| Stage | Command | What it does | Status |
|---|---|---|---|
| Get started | `/start-here` | This overview | ✅ |
| Get started | `/setup` | Teach it your team's rules: language, brand, links, footer, senders, test customers, strictness | ✅ |
| Get started | `/house-rules` | View or change those rules; mark a finding "fine for us" | ✅ |
| Get started | `/connect` | Connect Braze, Klaviyo or Iterable with a read-only key | 🧪 |
| Get started | `/refresh` | Pull the latest campaigns, journeys, segments, templates and content blocks (or load the demo) | 🧪 |
| Plan and build | `/plan-journey` | Design a journey and check it for overlap with what's already live | 🧪 |
| Plan and build | `/build-plan` | Step-by-step build instructions in your platform's own terms | 🧪 |
| Plan and build | `/bulk-edit` | Preview a find-and-replace across every subject, body and content block | 🧪 |
| Change safely | `/what-breaks` | What's affected if you change or delete an attribute, segment, block, event or link | 🧪 |
| Change safely | `/what-changed` | What changed in the account since last time, live items first | 🧪 |
| Change safely | `/edit-plan` | The safe way to change something live (copy, running journeys, shared blocks, audiences) | 🧪 |
| Change safely | `/show-journey` | Draw a live journey as a diagram, with structural problems flagged | 🧪 |
| Send with confidence | `/check-campaign` | A whole campaign or journey: every message, settings and structure | 🧪 |
| Send with confidence | `/check-email` | One email: HTML, links, unsubscribe, UTMs, personalization, house rules | ✅ |
| Send with confidence | `/check-push` | One push: lock-screen length for your longest names, deep links, blanks | ✅ |
| Send with confidence | `/check-sms` | One text: billed segments, Unicode traps, opt-out wording, sender name | ✅ |
| Send with confidence | `/check-in-app` | One in-app message or content card: length, buttons, links | ✅ |
| Prove the impact | `/watch-launch` | Bounce, unsubscribe, spam and delivery rates against thresholds | 🧪 |
| Prove the impact | `/ops-report` | Messages checked, problems caught, hours saved, for you or the whole team | ✅ |
| Prove the impact | `/report-problem` | Report a wrong result; it becomes a test case and gets fixed | ✅ |

**Best first steps** (pick the one that fits; don't list all three if one clearly applies):
1. **Just looking?** `/refresh demo` loads a fictional brand's Braze workspace (no account needed). Then try
   `/check-campaign Price Drop Alert`, `/what-breaks loyalty_tier` or `/show-journey Welcome Series`.
2. **Have an email to check?** Paste it and run `/check-email`.
3. **Using it for real?** `/setup` (about 5 minutes) so checks follow your team's conventions, then `/connect`.
