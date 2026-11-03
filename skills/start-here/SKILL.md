---
name: start-here
description: Overview of crm-lifecycle-ops. What each command does, what works today, and the best first step. Use when someone asks "what can this do", "how do I use crm-lifecycle-ops", "help", or seems unsure which command to run.
---

# Start here

Explain briefly, in this order, then suggest one next step that fits what they're doing.

**What it is:** a set of tools for the people who plan, build, QA and run lifecycle/CRM campaigns
on Braze, Klaviyo or Iterable. Read-only by default: it never sends anything and never edits your
account without showing a preview and getting a yes.

**Commands** (✅ works today · 🧪 early · 🗺 coming; keep this list in sync with the README):

| Stage | Command | What it does | Status |
|---|---|---|---|
| Start | `/start-here` | This overview | ✅ |
| QA | `/check-email` | Full QA on one email: HTML, links, unsubscribe, UTMs, personalization for several test profiles | ✅ |
| Feedback | `/report-problem` | Report a wrong result; it becomes a test case and gets fixed | ✅ |
| Setup | `/connect` | Connect Braze, Klaviyo or Iterable (read-only keys) | 🗺 |
| Setup | `/refresh` | Pull the latest campaigns, journeys, segments and templates | 🗺 |
| QA | `/check-campaign` | QA a whole campaign or journey: every message plus settings | 🗺 |
| Impact | `/what-breaks` | "If I change or delete this, what live things are affected?" | 🗺 |
| Impact | `/what-changed` | What changed in the account since you last looked | 🗺 |
| Plan | `/plan-journey` | Design a new journey and check it against what's already live | 🗺 |
| Plan | `/show-journey` | Draw a live journey as a diagram | 🗺 |
| Build | `/build-plan` | Turn a brief into a step-by-step build checklist | 🗺 |
| Build | `/bulk-edit` | Find-and-replace across many templates, with a preview | 🗺 |
| Launch | `/watch-launch` | Health check after a send: bounces, unsubscribes, stalls | 🗺 |
| Report | `/ops-report` | Errors caught, time saved, how much the tools are used | 🗺 |

**Best first step today:** paste an email's HTML and run `/check-email`.
