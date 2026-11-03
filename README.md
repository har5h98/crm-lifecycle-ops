# crm-lifecycle-ops

**The AI copilot for lifecycle and CRM operations on Braze, Klaviyo and Iterable.**
Plan, build, check and change campaigns faster, without breaking what's live. It's a Claude Code plugin,
read-only by design: it never sends or edits anything.

[![CI](https://github.com/har5h98/crm-lifecycle-ops/actions/workflows/ci.yml/badge.svg)](https://github.com/har5h98/crm-lifecycle-ops/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/har5h98/crm-lifecycle-ops)](https://github.com/har5h98/crm-lifecycle-ops/releases)
![Status: early alpha](https://img.shields.io/badge/status-early%20alpha-orange)
![License: MIT](https://img.shields.io/badge/license-MIT-blue)

<p align="center"><img src="https://raw.githubusercontent.com/har5h98/crm-lifecycle-ops/main/docs/demo.png" alt="Terminal showing /check-campaign flagging a staging link and a blank first name, /what-breaks listing live programs that use loyalty_tier, and /edit-plan warning that a footer block is shared by three other live programs before giving Braze steps" width="820"></p>

Lifecycle teams lose hours to work that lives in people's heads: how to build this in our platform, what this
segment feeds, whether this message looks right for someone with no first name. crm-lifecycle-ops knows your live
account and your team's rules, and helps at every step of an operator's job:

| | What you get | Commands |
|---|---|---|
| **Plan and build faster** | Design journeys that don't collide with what's live, and get click-by-click build steps in *your* platform's terms, with your naming, UTMs and reusable segments | `/plan-journey` · `/build-plan` · `/bulk-edit` |
| **Change safely** | Before you edit an attribute, segment, content block or live journey: what depends on it, what changed overnight, and the safe way to make the change | `/what-breaks` · `/what-changed` · `/edit-plan` · `/show-journey` |
| **Send with confidence** | Every email, push, SMS, in-app, content card and webhook checked as every kind of customer, against your team's rules | `/check-campaign` · `/check-email` · `/check-push` · `/check-sms` · `/check-in-app` |
| **Prove the impact** | Delivery health after launch, plus problems caught and hours saved, for you or the whole team | `/watch-launch` · `/ops-report` |

**Built for** lifecycle, CRM and marketing-ops teams who build campaigns by hand. **Try it in 2 minutes** with the
built-in demo account; no platform access needed.

> **Status: early alpha.** ✅ works fully today. 🧪 works on the built-in demo account and against mocked
> Braze/Klaviyo/Iterable API responses, but hasn't been field-tested on real accounts yet. If something's off,
> `/report-problem` turns it into a test case and a fix.

## All commands

| | Command | What it does | Status |
|---|---|---|---|
| **Get started** | `/start-here` | Overview and the best first step | ✅ |
| | `/setup` | Teach it your team's rules: language, brand, links, footer, senders, test customers, strictness | ✅ |
| | `/house-rules` | View or change those rules; mark a finding "fine for us" | ✅ |
| | `/connect` | Connect Braze, Klaviyo or Iterable with a read-only key | 🧪 |
| | `/refresh` | Pull the latest campaigns, journeys, segments, templates and content blocks (or load the demo) | 🧪 |
| **Plan and build** | `/plan-journey` | Design a journey and check it for overlap with what's already live | 🧪 |
| | `/build-plan` | Step-by-step build instructions in your platform's own terms, with your rules and reusable assets | 🧪 |
| | `/bulk-edit` | Preview a find-and-replace across every subject, body and content block | 🧪 |
| **Change safely** | `/what-breaks` | What's affected if you change or delete an attribute, segment, block, event or link | 🧪 |
| | `/what-changed` | What changed in the account since last time, live items first | 🧪 |
| | `/edit-plan` | The safe way to change something live (copy, running journeys, shared blocks, audiences) | 🧪 |
| | `/show-journey` | Draw a live journey as a diagram, with structural problems flagged | 🧪 |
| **Send with confidence** | `/check-campaign` | Check a whole campaign or journey: every message on every channel, settings and structure | 🧪 |
| | `/check-email` | One email: HTML, links, unsubscribe, UTMs, personalization, house rules | ✅ |
| | `/check-push` | One push: lock-screen length for your longest names, deep links, blanks | ✅ |
| | `/check-sms` | One text: billed segments, Unicode traps, opt-out wording, sender name | ✅ |
| | `/check-in-app` | One in-app message or content card: length, buttons, links | ✅ |
| **Prove the impact** | `/watch-launch` | Bounce, unsubscribe, spam and delivery rates against stated thresholds | 🧪 |
| | `/ops-report` | Messages checked, problems caught, hours saved, for you or the whole team | ✅ |
| | `/report-problem` | Report a wrong result; it becomes a test case and gets fixed | ✅ |

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
4. `/connect` when you're ready to use your own account: read-only keys, entered in the plugin's settings
   (`/plugin configure crm-lifecycle-ops`) and kept in your system's secure storage, never pasted into chat.

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

## What "check" covers

| Channel | Catches |
|---|---|
| **Email** | Broken Outlook `<!--[if mso]>` blocks, unclosed tables, missing alt text, Gmail clipping (estimated with link tracking), missing preheader; links to staging/dev/localhost, malformed or relative links, `http://`, inconsistent UTMs, broken pages (live check); unsubscribe (skipped for transactional mail) |
| **Push** | Title and body length for your *longest* customer names, line breaks that hide titles on iOS, deep-link format and destination, Android's required title (Braze) |
| **SMS** | Billed segments the way carriers count them, the exact character that switches a text to Unicode, opt-out wording and sender name, each platform's limits and auto-appended text |
| **In-app** | Body length, buttons and their links, click-through destination, HTML structure |
| **Content cards** | Title and message length, card link and image destinations |
| **Webhooks** | Missing or staging URLs, keys written into the URL, JSON bodies that break when a customer's name contains a quote |
| **Personalization** (all) | Renders every message for a *complete*, an *empty*, a *long-values* and an *accented-name* profile (or your own): `Hi ,` blanks, literal `null`, leftover `{{ }}`, template errors, Iterable comparisons that silently skip the send |
| **Campaigns & journeys** | Audience and conversion event set, naming convention, dead-end branches, unreachable steps, empty message steps |

Braze Liquid, Klaviyo's template language and Iterable Handlebars are all supported; platform tags the
engine can't reproduce locally (coupon codes, catalog lookups, Connected Content) are reported as
*not verified*, never as passing or failing. The full list, with ids: [`src/checks/catalog.ts`](src/checks/catalog.ts).

**Pass/fail is decided by deterministic code, never by AI.** Claude adds a clearly labelled advisory
review (subject line, CTA, tone) on top.

### Example (real output from the demo account)

```
/check-campaign Price Drop Alert          🔴 Don't send. 1 blocking problem

fail  links.non-production-host        "See items" points at staging.fernbrook.example
warn  personalization.dangling-punct.  Someone with no first name on file sees "Hi ,"
warn  links.utm-inconsistent           1 of 2 links carry UTM tags; "Help" doesn't
warn  html.img-missing-alt             1 image has no alt text

/check-sms Flash Sale Text                🟡 Fix before sending

warn  sms.unicode            "’" and "—" switch the text to Unicode: 70 characters per segment, not 160.
                             Swap ’ → ' and — → -
warn  sms.too-many-segments  Up to 3 billed segments; house limit is 2
warn  sms.no-opt-out         No "Reply STOP to opt out"
```

## Using it day to day

The [operator guide](docs/operator-guide.md) is a one-page routine: setup, what to run at each step of a build,
how to read results, and the weekly review.

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
- **Braze content cards** come back from the API with few fields, so card checks are fullest when the copy is pasted into `/check-in-app`.
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
