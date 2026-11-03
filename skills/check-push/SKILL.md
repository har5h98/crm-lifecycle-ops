---
name: check-push
description: QA a push notification before it sends. Title and body length on lock screens for every test profile, personalization blanks, deep link format and destination, image link, brand terms. Use when someone says "check this push", "QA this notification", or pastes push copy.
argument-hint: "<title and body, plus deep link if any>"
---

# Check a push notification

1. Get the message. Work out the platform from the template syntax (Braze `{{${first_name}}}`, Klaviyo
   `{{ first_name }}` / `|lookup:`, Iterable `{{firstName}}` / `defaultIfEmpty`); ask if unclear.
- Ask for the **title**, **body** and **deep link** (and image URL if any). Pass them as `title`, `body`, `deep_link`, `image_url`.
- Report the longest rendered title and body lengths from `stats` next to the house limits, and say which profile produced the longest one (long names are the usual cause).
- If the deep link is missing and the push is about something specific, say what the tap will do instead (open the app's home screen).
2. Call `check_message` with `channel: push`. Leave `personas` empty so the team's own test profiles are used.
3. Report like `/check-email`: verdict first (🔴 Don't send · 🟡 Fix first · 🟢 Ready), then findings worst
   first in plain words, then **What I couldn't check** (verbatim), then a one-line count of anything waived
   by house rules.
4. **Advisory (AI review, not part of pass/fail)**: 2–4 bullets on clarity, urgency without spamminess, CTA,
   and tone, using the team's spelling variant and tone from `get_house_rules`.
5. Close: fine for your team → `/house-rules`; tool got it wrong → `/report-problem`.
