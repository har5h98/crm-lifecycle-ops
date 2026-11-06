# How crm-lifecycle-ops works

A plain-language tour of the moving parts: what happens when you run a command, where the data comes
from, which decisions are made by code and which by AI, and why it's built this way.

## The one-paragraph version

The plugin has two halves. **Skills** are written instructions that tell Claude how to run each
command (`/check-email`, `/what-breaks`…): what to ask, which tools to call and how to explain the result.
The **engine** is a small program that runs on your computer and gives Claude tools: it reads your
Braze/Klaviyo/Iterable account through their APIs, keeps a local copy (a *snapshot*), and runs
rule-based checks. Claude never decides pass/fail itself: the engine does, with fixed rules. Claude's
job is to understand what you're asking, call the right tools, and explain the results in plain words.

```
 You ──▶ Claude ──reads──▶ Skill (/check-campaign instructions)
            │
            └──calls tools──▶ Engine (MCP server on your machine)
                                 ├─ Adapters ──read-only API calls──▶ Braze / Klaviyo / Iterable
                                 ├─ Snapshot (local copy of the account)
                                 ├─ Checks (HTML, links, personalization, push, SMS, in-app, journeys)
                                 ├─ Dependency map (what uses what)
                                 └─ House rules (what "right" means for your team)
```

## 1. Getting the account's information

**How it connects.** You create a *read-only* API key in your platform (`/connect` walks you through
which permissions to tick) and enter it in the plugin's settings (`/plugin configure crm-lifecycle-ops`).
Claude Code keeps it in the system's secure storage and passes it only to the plugin's server. The key is
never pasted into the chat and never leaves your machine except to call the platform's own API.

**What `/refresh` does.** The engine calls the platform's REST API and pulls everything into one
platform-neutral snapshot:

| Pulled | Braze | Klaviyo | Iterable |
|---|---|---|---|
| Campaigns + their messages (email, push, SMS, in-app) | ✅ | ✅ | ✅ |
| Journeys and their step graph | ✅ Canvas steps + paths | ✅ flow actions + links | ⚠️ list only, no step order |
| Who each campaign/journey targets | ❌ not in the API | ✅ | ✅ lists |
| Segment logic | ⚠️ prose description | ✅ full definition | ⚠️ lists only |
| Shared content and where it's used | ✅ content blocks + inclusion data | — | — |

The first refresh pulls everything; later ones only re-fetch items edited since the last snapshot.
Snapshots are saved locally (`~/.crm-lifecycle-ops/snapshots/`), which is what makes `/what-changed`
possible: it compares two snapshots.

**Why its own API connection, not the vendors' MCP servers?** Braze, Klaviyo and Iterable each publish an
official MCP server. They're good for asking questions about data, but each exposes a different, partial set of
tools (Braze's, for example, excludes some content and is OAuth-scoped to one user). To QA every message
body, walk journey graphs and map dependencies the same way on all three platforms, the engine needs the
raw objects, so it calls the REST APIs directly and maps them into one shared model. Adding a platform
means writing one adapter; every check and command then works on it.

**Filling the gaps.** Where an API can't tell us something (Braze doesn't say which segment a Canvas
targets), the engine says so instead of guessing. `/what-breaks` lists those as "can't rule out" and can
read the answer off your dashboard through Claude in Chrome, one page at a time with your permission.
That fact is stored as *seen on screen* with a date.

## 2. QA: how a message gets checked

Every check produces a **finding** with an id (e.g. `links.non-production-host`), a severity (fail /
warn / info), the evidence, and a fix. The full list lives in `src/checks/catalog.ts`.

**Personalization is tested by rendering, not by reading.** The engine renders the template the way the
platform would (Liquid for Braze, a Liquid approximation for Klaviyo, Handlebars for Iterable) for
several *made-up* profiles: a complete one, an empty one, one with long values, one with an accented name
(which can switch a text message to Unicode), plus any the team defines. It then compares the outputs. If the empty profile produces "Hi ," and the complete one
doesn't, that's a missing fallback. Comparing against the complete profile is what keeps false alarms down.
Real customer data is never used.

**Per channel:**
- **Email**: HTML structure (Outlook conditional comments, unclosed tables), Gmail's ~102 KB clipping,
  alt text, the inbox preview (a missing preheader, one that repeats the subject, or "View in browser"
  showing instead), links (staging hosts, `http://`, broken pages, UTM consistency), unsubscribe, and
  accessibility (`lang`, vague or nameless links, layout tables, text under 12px).
- **Push**: title/body length for the *longest* rendered profile against lock-screen limits, deep-link format and destination.
- **SMS**: counts billed segments the way carriers do (GSM-7: 160, then 153 per segment; a single
  smart quote or emoji switches to Unicode: 70, then 67), shows the exact character to swap, checks
  opt-out wording and sender name, and knows each platform's behaviour: Iterable appends 48 characters of
  opt-out text by default (so it counts them), Klaviyo toggles it per message, Braze leaves it to you and
  rejects texts over 10 segments.
- **In-app**: body length, buttons and their links, HTML structure where relevant.
- **Content cards**: title and message length, card link and image destinations.
- **Webhooks**: missing or staging URLs, keys written into the URL, JSON bodies that break when a customer's
  name contains a quote.
- **Campaign & journey settings**: audience set, conversion event, naming, and the journey graph
  (dead-end branches, steps nothing can reach, empty message steps).

**AI's role in QA is advisory only.** After the rule-based verdict, Claude adds a clearly labelled review
of copy, tone and clarity. It can't change the verdict. This is a deliberate design choice: a QA tool that
sometimes passes something because a model guessed wrong is worse than no tool.

## 3. House rules: what "right" means for *your* team

Checks come in three layers:
1. **Locked**: wrong for everyone (no unsubscribe, broken template syntax, broken links). Can't be turned off.
2. **Defaults**: sensible everywhere; a team can re-grade or turn them off.
3. **House rules**: only run once a team states its convention: spelling variant, date format,
   brand terms, banned phrases, approved domains and senders, UTM naming pattern, required footer
   text, push/SMS/in-app limits, deep-link format, name fallback, naming convention, test profiles.

`/setup` builds the rulebook in a few short rounds of questions, and can **learn from an email the team
already considers right** (reading off its domains, UTM pattern, sender, footer, fallback and spelling)
and propose rules to confirm. "This finding is fine for us" becomes a recorded *exception with a reason*;
"the tool is wrong" becomes a bug report. Teams share one rulebook file (the **Shared rules file** setting) so
everyone is judged the same way.

## 4. Impact: "what breaks if I change this?"

The snapshot is turned into a **dependency map**: which messages use which attribute (found by parsing
templates), which segments filter on it, which campaigns and journeys target those segments, which
messages include which content block, which programs trigger on which event. `/what-breaks` walks that
map from the thing you want to change and lists every dependent, **live ones first**, each labelled with
*how we know*:

- **confirmed by the API**: the platform said so;
- **read from the template**: found in the message's code;
- **read from the segment description**: Braze's prose description of the filters mentions it;
- **seen on screen** (with a date): read from the dashboard;
- **can't rule out**: live, but the API hides the link.

If the name you asked about isn't in the snapshot (often a typo), it says so and suggests the closest
names, rather than returning an empty list that would read as "safe to change".

`/plan-journey` uses the same map in reverse: before you build, it finds live programs that already
target the same people or trigger on the same event (double-send and conflicting-offer risk).

## 5. Build and edit guidance

The plugin never builds or edits inside the platform: that's a deliberate safety line. Instead
`/build-plan` and `/edit-plan` produce step-by-step instructions **in the platform's own words**
(Canvas vs flow vs journey). They come from a procedure library (`src/guides/`): 12 common tasks × 3
platforms, each checked against the vendor's documentation with a source link and a "verified on" date,
including the rules that trip people up (Braze conversion events can't change after launch; Klaviyo's
Manual → Live doesn't release queued sends; Iterable journey campaign edits go live without republishing).
Each plan is filled in with the team's specifics:
- the name that fits the naming convention, the approved sender, the exact UTM parameters;
- personalization written in that platform's syntax with the team's fallback;
- existing segments and footer blocks to reuse instead of rebuilding;
- for edits: whether the item is live, the platform's rules for editing live programs, and any shared
  content block that would change other live programs too.

## 6. Monitoring and reporting

- `/what-changed` compares snapshots, so a daily refresh catches unannounced edits.
- `/watch-launch` pulls delivery numbers and grades bounce, unsubscribe, spam-complaint and delivery
  rates against stated thresholds (e.g. Gmail's guidance to stay under 0.3% spam complaints).
- `/check-campaign` can save a **QA sign-off report** (Markdown): verdict, every finding, what couldn't be
  verified, and a reviewer sign-off block, for the launch ticket.
- `/ops-report` reads a local log of tool runs (check ids and counts, never content): emails checked,
  blocking problems caught, most common issues, weekly trend, estimated hours saved (assumption stated).

## 7. How quality is kept up

- **Regression corpus.** `tests/corpus/` holds example emails with the findings they must and must not
  produce. Every wrong result someone reports becomes a case there *before* it's fixed.
- **Adapters are tested** against canned API responses shaped like each vendor's published examples.
- **CI** runs type checks, tests and a build on every change; CodeQL scans for security issues; secret
  scanning blocks committed keys; Dependabot keeps dependencies current.
- **Vendor drift watch.** A weekly job fingerprints the Braze, Klaviyo and Iterable API specs and opens an
  issue when one changes. Vendor *screens* change without an API change, so a monthly job also opens a
  checklist to re-verify every build and edit guide against its doc links; plans warn users when their guide
  is more than 90 days past verification.
- **Auto-fix loop.** A maintainer can label a confirmed wrong-result issue `autofix`; Claude writes the test
  case and the fix as a pull request for human review.

## 8. Design decisions worth knowing

| Decision | Why |
|---|---|
| Rule-based verdicts, AI explanations | QA must be repeatable; a model can explain and advise but shouldn't be the judge |
| Read-only, never sends, never edits | Teams can adopt it without risking a production account; trust comes first |
| One shared model across three platforms | Every check works on every platform; adding a platform is one adapter |
| Confidence label on every dependency | "I can't see this" is better than false confidence |
| Synthetic test profiles only | No customer data ever leaves the platform |
| Local snapshots and logs | Nothing is sent to a third-party server |
| Same engine in Claude and on the command line | `crm-lifecycle-ops check` gives CI pipelines the identical verdicts |
| House rules, with locked checks | Teams differ on style, not on compliance |

## 9. Known limits

- Local rendering approximates each platform (Braze Connected Content and catalog lookups aren't executed).
- Braze doesn't expose campaign targeting by API; Iterable doesn't expose journey step order.
- Adapters are tested against vendor-documented response shapes; field-testing on live accounts is ongoing.
- Braze content cards come back from the API with few fields, so card checks are fullest when the copy is pasted.
