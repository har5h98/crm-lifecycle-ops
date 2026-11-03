---
name: check-sms
description: QA a text message before it sends. Billed segment count and encoding (smart quotes and emoji that halve the length), opt-out wording, sender name, links, and personalization blanks for every test profile. Use when someone says "check this SMS", "QA this text", "how many segments is this", or pastes text-message copy.
argument-hint: "<the text message>"
---

# Check an SMS

1. Get the message. Work out the platform from the template syntax (Braze `{{${first_name}}}`, Klaviyo
   `{{ first_name }}` / `|lookup:`, Iterable `{{firstName}}` / `defaultIfEmpty`); ask if unclear.
- Pass the text as `body`.
- Lead with **segments and encoding** from `stats` (e.g. "2 segments, Unicode because of ’"). If smart quotes or dashes forced Unicode, show the exact swap that brings it back to 160-character segments.
- Opt-out and sender-name findings: explain they come from US carrier (CTIA) expectations and that `/house-rules` can turn them off if the platform appends them automatically.
2. Call `check_message` with `channel: sms`. Leave `personas` empty so the team's own test profiles are used.
3. Report like `/check-email`: verdict first (🔴 Don't send · 🟡 Fix first · 🟢 Ready), then findings worst
   first in plain words, then **What I couldn't check** (verbatim), then a one-line count of anything waived
   by house rules.
4. **Advisory (AI review, not part of pass/fail)**: 2–4 bullets on clarity, urgency without spamminess, CTA,
   and tone, using the team's spelling variant and tone from `get_house_rules`.
5. Close: fine for your team → `/house-rules`; tool got it wrong → `/report-problem`.
