---
name: check-email
description: QA an email before it sends. Checks HTML, links, unsubscribe, UTMs and personalization (renders it for several test profiles) for Braze, Klaviyo or Iterable templates. Use when someone says "check this email", "QA this template", "is this ready to send", or pastes email HTML.
argument-hint: "<paste HTML, or a path to an .html file>"
---

# Check an email

Run a full pre-send QA pass on one email and give a clear verdict.

## 1. Get the email
- Pasted HTML → use it as `html`. A file path → pass it as `file` (absolute path).
- If nothing was given, ask for the HTML or a file path. Also ask for the subject line and preheader
  if they're not in the HTML; they're optional but get checked when present.
- Work out the platform from the syntax and say which you picked:
  - `{{${first_name}}}`, `custom_attribute.${…}`, `content_blocks`, `abort_message` → **braze**
  - `{% unsubscribe %}`, `|lookup:`, `person.` , `|default:'x'` → **klaviyo**
  - `{{defaultIfEmpty …}}`, `{{#if …}}`, camelCase fields like `{{firstName}}` → **iterable**
  - Can't tell → ask.

## 2. Run the checks
Call the `check_email` tool with `check_links_live: true` (it requests each link, so it catches
broken pages). If the person gave real test profiles, pass them as `personas`; otherwise leave it
empty and the tool builds complete / empty / edge-case profiles itself.

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

## 4. Advisory review (clearly labelled, never changes the verdict)
Under a heading **Advisory (AI review, not part of pass/fail)**, briefly review: subject and preheader
(length, clarity, do they work together), CTA clarity, spelling, and tone. Keep it to 3–5 bullets.

## 5. Close
One line: *If any finding looks wrong, run `/report-problem` and it'll be fixed and added to the test suite.*
