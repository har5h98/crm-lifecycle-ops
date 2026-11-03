# crm-lifecycle-ops

**QA, dependency checks and journey tools for lifecycle & CRM marketing on Braze, Klaviyo and Iterable, as a Claude plugin.**

[![CI](https://github.com/har5h98/crm-lifecycle-ops/actions/workflows/ci.yml/badge.svg)](https://github.com/har5h98/crm-lifecycle-ops/actions/workflows/ci.yml)
![Status: early alpha](https://img.shields.io/badge/status-early%20alpha-orange)
![License: MIT](https://img.shields.io/badge/license-MIT-blue)

Lifecycle and CRM teams lose hours to manual QA and to the fear of changing something that quietly
breaks a live journey. This plugin catches the mistakes before they send, and (as it grows) tells you
what depends on what before you change it.

> **Status: early alpha.** `/check-email` works today. The rest of the commands are being built in the
> open; the table below is the honest current state. Found a wrong result? Run `/report-problem`.
> Every report becomes a permanent test case.

## Commands

| Stage | Command | What it does | Status |
|---|---|---|---|
| Start | `/start-here` | Overview and the best first step | ✅ |
| QA | `/check-email` | Full QA on one email: HTML, links, unsubscribe, UTMs, personalization for several test profiles | ✅ |
| Feedback | `/report-problem` | Report a wrong result; it becomes a test case and gets fixed | ✅ |
| Setup | `/connect` | Connect Braze, Klaviyo or Iterable with read-only keys | 🗺 next |
| Setup | `/refresh` | Pull the latest campaigns, journeys, segments and templates | 🗺 next |
| QA | `/check-campaign` | QA a whole campaign or journey: every message plus settings | 🗺 |
| Impact | `/what-breaks` | "If I change or delete this, what live things are affected?" | 🗺 |
| Impact | `/what-changed` | What changed in the account since you last looked | 🗺 |
| Plan | `/plan-journey` | Design a new journey and check it against what's already live | 🗺 |
| Plan | `/show-journey` | Draw a live journey as a diagram | 🗺 |
| Build | `/build-plan` | Turn a brief into a step-by-step build checklist | 🗺 |
| Build | `/bulk-edit` | Find-and-replace across many templates, with a preview first | 🗺 |
| Launch | `/watch-launch` | Health check after a send: bounces, unsubscribes, stalls | 🗺 |
| Report | `/ops-report` | Errors caught, time saved, adoption | 🗺 |

✅ works · 🧪 early · 🗺 planned

## Install

Needs [Claude Code](https://claude.com/claude-code) (or Claude Desktop with plugins) and Node.js 20+.

```
/plugin marketplace add har5h98/crm-lifecycle-ops
/plugin install crm-lifecycle-ops@crm-lifecycle-ops
```

Then paste an email's HTML and run `/check-email`.

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

## What it can't see (yet)

Honesty over false confidence: every result says what it couldn't verify.

- **Local rendering is an approximation.** Braze `connected_content` and catalog lookups aren't executed,
  and Klaviyo's template language is approximated with Liquid. These are reported as *not verified*, never as passing.
- **Braze's API doesn't expose which segment a campaign targets**, so the planned `/what-breaks` will
  label those links "unknown" until they can be read from the Braze dashboard.

## Safety

Read-only by default. It never sends a message, never reads customer profiles (it tests with
synthetic personas), and keeps your keys on your machine. See [SECURITY.md](SECURITY.md).

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
