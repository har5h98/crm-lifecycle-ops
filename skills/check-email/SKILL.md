---
name: check-email
description: QA an email before it sends. Checks HTML, links, unsubscribe, UTMs and personalization (renders it for several test profiles) for Braze, Klaviyo or Iterable templates. Use when someone says "check this email", "QA this template", "is this ready to send", or pastes email HTML.
argument-hint: "<paste HTML, or a path to an .html file>"
---

# Check an email

Run a full pre-send QA pass on one email and give a clear verdict.

## 1. Get the email
- Pasted HTML → use it as `html`. A file path → pass it as `file` (absolute path).
- If nothing was given, ask for the HTML or a file path. Also ask for the subject line, preheader and
  sender if they're not in the HTML; they're optional but get checked when present.
- Work out the platform from the syntax and say which you picked:
  - `{{${first_name}}}`, `custom_attribute.${…}`, `content_blocks`, `abort_message` → **braze**
  - `{% unsubscribe %}`, `|lookup:`, `person.` , `|default:'x'` → **klaviyo**
  - `{{defaultIfEmpty …}}`, `{{#if …}}`, camelCase fields like `{{firstName}}` → **iterable**
  - Can't tell → ask.

## 2. Run the checks
Call the `check_email` tool with `check_links_live: true` (it requests each link, so it catches
broken pages). Pass `subject`, `preheader` and `from` when known. Leave `personas` empty: the tool uses the
team's own test personas from the house rules (or builds complete / empty / edge-case ones).

The tool applies the team's **house rules** automatically. If the result says `houseRules: none yet`,
add one line at the end: *"Run `/setup` (5 minutes) so checks follow your team's language, links, footer and style."*

## 3. Report: verdict first, then detail
Start with one line:
- 🔴 **Don't send.** N blocking problems (any `fail`)
- 🟡 **Fix before sending.** N warnings (no fails, some warns)
- 🟢 **Ready to send.** (only `info`, or nothing)

Then a table of findings, worst first: severity · what's wrong (plain English) · where (the
`evidence`) · how to fix. Group repeats (e.g. three unclosed tags from one cause) into one row and
say so. If a finding came from a persona, say which kind of customer would see it ("someone with no
first name on file would see *Hi ,*").

Then **"What I couldn't check"**: list `notVerified` verbatim. Never imply these passed.

If anything was **waived** by house rules, add one line: "N findings waived by your house rules"
(list them only if asked).

## 4. Advisory review (clearly labelled, never changes the verdict)
Under a heading **Advisory (AI review, not part of pass/fail)**, briefly review: subject and preheader
(length, clarity, do they work together), CTA clarity, spelling and grammar, and tone. Use the house
rules (`get_house_rules`): judge spelling in the team's variant (US/GB), match the stated tone, and
review non-English copy in its own language. Keep it to 3–5 bullets.

## 5. Close
One line on disagreeing:
- *Fine for your team?* → `/house-rules` records it as an exception, with your reason.
- *The tool got it wrong?* → `/report-problem`; it'll be fixed and added to the test suite.
