---
name: start-here
description: Overview of crm-lifecycle-ops. What each command does, what works today, and the best first step. Use when someone asks what crm-lifecycle-ops can do, how to use it, or which of its commands to run.
---

# Start here

Explain briefly, in this order, then suggest one next step that fits what they're doing.

**What it is:** tools for the people who plan, build, QA and run lifecycle/CRM programs on Braze,
Klaviyo or Iterable. Read-only: it never sends anything and never edits the account.

**Commands** (✅ works · 🧪 works on the demo account and mocked APIs, not yet field-tested on real
accounts; keep this list in sync with the README):

| Stage | Command | What it does | Status |
|---|---|---|---|
| Start | `/start-here` | This overview | ✅ |
| Start | `/setup` | Teach it your team's rules: language, brand, links, footer, senders, personas, strictness | ✅ |
| Start | `/house-rules` | View or change those rules; mark a finding "fine for us" | ✅ |
| Setup | `/connect` | Connect Braze, Klaviyo or Iterable with a read-only key | 🧪 |
| Setup | `/refresh` | Pull the latest campaigns, journeys, segments and templates (or load the demo) | 🧪 |
| QA | `/check-email` | Full QA on one email | ✅ |
| QA | `/check-push` | Push QA: lock-screen length for your longest names, deep links, personalization blanks | ✅ |
| QA | `/check-sms` | SMS QA: billed segments and Unicode traps, opt-out wording, sender name, links | ✅ |
| QA | `/check-in-app` | In-app QA: length, buttons and their links, HTML structure | ✅ |
| QA | `/check-campaign` | QA a whole campaign or journey: every message on every channel plus settings and structure | 🧪 |
| Impact | `/what-breaks` | "If I change or delete this, what live things are affected?" | 🧪 |
| Impact | `/what-changed` | What changed in the account since last time | 🧪 |
| Plan | `/plan-journey` | Design a journey and check it against what's live | 🧪 |
| Plan | `/show-journey` | Draw a live journey as a diagram | 🧪 |
| Build | `/build-plan` | Step-by-step build instructions in your platform\'s own terms, filled in with your house rules and reusable assets | 🧪 |
| Build | `/edit-plan` | How to safely change something that exists (live copy, running journeys, shared blocks, audiences), and what else it affects | 🧪 |
| Build | `/bulk-edit` | Find-and-replace preview across every email | 🧪 |
| Launch | `/watch-launch` | Health check after a send | 🧪 |
| Report | `/ops-report` | What the checks caught and time saved | ✅ |
| Feedback | `/report-problem` | Report a wrong result; it becomes a test and gets fixed | ✅ |

**Best first steps:**
1. `/setup` (5 minutes) so checks follow your team's conventions.
2. Paste an email and run `/check-email`.
3. No account connected yet? `/refresh demo` loads a fictional brand so you can try `/what-breaks loyalty_tier`,
   `/show-journey Welcome Series` or `/check-campaign Price Drop Alert`.
