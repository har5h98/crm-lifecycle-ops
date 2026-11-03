---
name: check-in-app
description: QA an in-app message (modal, slide-up, full-screen or HTML) or a content card before it goes live. Body length, buttons and their links, click-through destination, HTML structure, and personalization blanks for every test profile. Use when someone says "check this in-app", "QA this modal", or pastes in-app copy.
argument-hint: "<header, body and buttons>"
---

# Check an in-app message

1. Get the message. Work out the platform from the template syntax (Braze `{{${first_name}}}`, Klaviyo
   `{{ first_name }}` / `|lookup:`, Iterable `{{firstName}}` / `defaultIfEmpty`); ask if unclear.
- Ask for the **header**, **body** (text or HTML) and **buttons** (label + link). Pass them as `title`, `body`, `buttons`, plus `deep_link` for a click-through on the message itself.
- For HTML in-app messages, the HTML structure checks apply but email-only ones (preheader, Gmail clipping, unsubscribe) are skipped. Say so if asked.
Klaviyo has no in-app message channel; its equivalent is in-app forms. If the platform is Klaviyo, say so in one line and still run the checks on the form's copy and buttons.
For a content card, use `channel: content-card` (title, message, card link).
2. Call `check_message` with `channel: in-app` (or `content-card`). Leave `personas` empty so the team's own test profiles are used.
3. Report like `/check-email`: verdict first (🔴 Don't send · 🟡 Fix first · 🟢 Ready), then findings worst
   first in plain words, then **What I couldn't check** (verbatim), then a one-line count of anything waived
   by house rules.
4. **Advisory (AI review, not part of pass/fail)**: 2–4 bullets on clarity, urgency without spamminess, CTA,
   and tone, using the team's spelling variant and tone from `get_house_rules`.
5. Close: fine for your team → `/house-rules`; tool got it wrong → `/report-problem`.
