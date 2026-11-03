# crm-lifecycle-ops

**QA, dependency checks and journey tools for lifecycle & CRM marketing on Braze, Klaviyo and Iterable, as a Claude plugin.**

[![CI](https://github.com/har5h98/crm-lifecycle-ops/actions/workflows/ci.yml/badge.svg)](https://github.com/har5h98/crm-lifecycle-ops/actions/workflows/ci.yml)
![Status: early alpha](https://img.shields.io/badge/status-early%20alpha-orange)
![License: MIT](https://img.shields.io/badge/license-MIT-blue)

Lifecycle and CRM teams lose hours to manual QA and to the fear of changing something that quietly
breaks a live journey. This plugin catches the mistakes before they send, and (as it grows) tells you
what depends on what before you change it.

> **Status: early alpha.** Every command below exists. ✅ means it works fully today. 🧪 means it works
> on the built-in demo account and against mocked Braze/Klaviyo/Iterable API responses, but hasn't been
> field-tested on real accounts yet. If you run it on yours and something's off, `/report-problem`
> turns it into a test case and a fix.

## Commands

| Stage | Command | What it does | Status |
|---|---|---|---|
| Start | `/start-here` | Overview and the best first step | ✅ |
| Start | `/setup` | Teach it your team's rules: language, brand, links, footer, senders, test personas, strictness | ✅ |
| Start | `/house-rules` | View or change those rules; mark a finding "fine for us" | ✅ |
| Setup | `/connect` | Connect Braze, Klaviyo or Iterable with a read-only key | 🧪 |
| Setup | `/refresh` | Pull the latest campaigns, journeys, segments, templates and content blocks (or load the demo) | 🧪 |
| QA | `/check-email` | Full QA on one email: HTML, links, unsubscribe, UTMs, personalization for several test profiles, house rules | ✅ |
| QA | `/check-push` | Push QA: lock-screen length for your longest names, deep links, personalization blanks | ✅ |
| QA | `/check-sms` | SMS QA: billed segments and Unicode traps, opt-out wording, sender name, links | ✅ |
| QA | `/check-in-app` | In-app QA: length, buttons and their links, HTML structure | ✅ |
| QA | `/check-campaign` | QA a whole campaign or journey: every message on every channel (content blocks expanded), settings and structure | 🧪 |
| Impact | `/what-breaks` | "If I change or delete this attribute, segment, block, event or link, what live things are affected?" | 🧪 |
| Impact | `/what-changed` | What changed in the account since last time, live items first | 🧪 |
| Plan | `/plan-journey` | Design a journey and check it for overlap with what's already live | 🧪 |
| Plan | `/show-journey` | Draw a live journey as a diagram, with structural problems flagged | 🧪 |
| Build | `/build-plan` | Step-by-step build instructions in your platform\'s own terms, filled in with your house rules and reusable assets | 🧪 |
| Build | `/edit-plan` | How to safely change something that exists (live copy, running journeys, shared blocks, audiences), and what else it affects | 🧪 |
| Build | `/bulk-edit` | Find-and-replace preview across every subject, body and content block | 🧪 |
| Launch | `/watch-launch` | Bounce, unsubscribe, spam and delivery rates against stated thresholds | 🧪 |
| Report | `/ops-report` | Emails checked, problems caught, hours saved | ✅ |
| Feedback | `/report-problem` | Report a wrong result; it becomes a test case and gets fixed | ✅ |

## Install

Needs [Claude Code](https://claude.com/claude-code) (or Claude Desktop with plugins) and Node.js 20+.

```
/plugin marketplace add har5h98/crm-lifecycle-ops
/plugin install crm-lifecycle-ops@crm-lifecycle-ops
```

Then:
1. `/setup`: five minutes of questions (or paste an email you're happy with and it learns from that).
2. `/check-email`: paste any email's HTML.
3. `/refresh demo`: load a fictional brand's Braze workspace and try `/what-breaks loyalty_tier`,
   `/show-journey Welcome Series` or `/check-campaign Price Drop Alert`, with no account needed.
4. `/connect` when you're ready to use your own account (read-only keys; never pasted into chat).

## Your rules, not just ours

What's "wrong" depends on the team, so checks come in three layers:

| Layer | Examples | Can a team change it? |
|---|---|---|
| **Locked**: wrong for everyone | No unsubscribe, template syntax that doesn't render, broken or malformed links | No |
| **Defaults**: sensible everywhere | Missing alt text, `http://` links, Gmail clipping, mixed UTM tagging | Re-grade or turn off |
| **House rules**: your conventions | US vs UK spelling, date format, brand terms, banned phrases, approved domains and senders, UTM naming, required footer/postal address, subject length and emoji, name fallback, naming convention, your own test personas | Set in `/setup` |

`/setup` asks short rounds of questions and can **learn from an email you already consider right**
(domains, UTM pattern, sender, footer, fallback, spelling). "That's fine for us" becomes a recorded
exception with a reason (`/house-rules`), which is different from "the tool is wrong" (`/report-problem`).
Teams share one rulebook by pointing `CLO_RULES` at a shared file.

## What `/check-email` checks

| Area | Catches |
|---|---|
| **HTML** | Unbalanced Outlook `<!--[if mso]>` blocks, unclosed tables/cells/divs, images without alt text, Gmail clipping (>102 KB), missing preheader |
| **Links** | No unsubscribe, staging/dev/localhost/example.com hosts, malformed URLs, `href="#"`, http://, inconsistent UTM tagging, broken pages (live check) |
| **Personalization** | Renders the template for a *complete*, an *empty* and an *edge-case* profile and flags `Hi ,` blanks, literal `null`/`undefined`, leftover `{{ }}`, syntax errors, and `abort_message` firing |
| **Subject line** | Empty, over 60 characters, personalization blanks |

Braze Liquid (`{{${first_name}}}`, `custom_attribute`, `abort_message`), Klaviyo's template language and
Iterable Handlebars (`defaultIfEmpty`) are all supported. The full list, with ids:
[`src/checks/catalog.ts`](src/checks/catalog.ts).

**Pass/fail is decided by deterministic code, never by AI.** Claude adds a clearly labelled advisory
review (subject line, CTA, tone) on top.

### Example

```
🔴 Don't send. 2 blocking problems

fail  html.outlook-conditionals   <!--[if mso]> is never closed. Outlook will hide everything after it
fail  links.no-unsubscribe        No unsubscribe link or tag found
warn  personalization.dangling…   Someone with no first name on file sees "Hi ,"
warn  links.utm-inconsistent      1 of 2 links carry UTM tags; "Recipes" doesn't
warn  links.empty-href            "Read more" links to "#"

What I couldn't check: content block "footer_v2" was not expanded.
```

## How it works

A plain-language tour of the architecture, data flow and design decisions: [docs/how-it-works.md](docs/how-it-works.md).

## What it can't see (yet)

Honesty over false confidence: every result says what it couldn't verify, and every dependency says
how it's known (*confirmed by the API*, *read from the template*, *read from the segment description*,
*seen on screen*).

- **Local rendering is an approximation.** Braze `connected_content` and catalog lookups aren't executed,
  and Klaviyo's template language is approximated with Liquid. These are reported as *not verified*, never as passing.
- **Braze's API doesn't say which segment a campaign or Canvas targets**, and gives segment filters only as
  prose. `/what-breaks` lists those live items as "can't rule out" and can read them from your Braze
  dashboard (via Claude in Chrome, one page at a time, with your OK).
- **Iterable's API doesn't return journey step order**, so Iterable journeys show their emails but not the path between them.
- **Webhooks and content cards aren't QA'd yet**; they're listed as not checked.
- **It never builds or edits in your account.** `/build-plan` and `/edit-plan` tell you exactly how; `/bulk-edit` previews only.

## Safety

Read-only. It never sends a message, never edits your account, never reads customer profiles (it tests
with synthetic personas), and keeps your keys on your machine in environment variables. See [SECURITY.md](SECURITY.md).

## How it gets better

1. **You report:** `/report-problem` turns a wrong result into a redacted GitHub issue (it asks before posting).
2. **It becomes a test:** each confirmed report is added to [`tests/corpus/`](tests/corpus) and must
   pass forever after.
3. **Fixes are drafted automatically:** a triaged issue can be handed to Claude, which writes the test
   and the fix as a pull request for human review.
4. **Vendor changes are watched:** a weekly job checks the Braze, Klaviyo and Iterable APIs and opens an
   issue when something the adapters depend on changes.

## Contributing

Wrong results are the most valuable contribution. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. Not affiliated with or endorsed by Braze, Klaviyo or Iterable; product names are trademarks of their owners.
