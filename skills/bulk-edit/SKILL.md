---
name: bulk-edit
description: Find and replace across many emails at once (promo code, URL, legal line, brand term) and preview every change before making it. Use when someone wants to replace a promo code, link, footer or phrase across many emails, texts or campaigns in their marketing platform. Not for code refactors.
argument-hint: "<find> → <replace>"
---

# Bulk edit (preview)

1. Get **find**, **replace**, and scope (all, or live only). Needs a snapshot; refresh first if it's stale.
2. `bulk_edit_preview`. Report: total matches, then each place, live first: item · where (subject, body,
   content block) · before → after snippet.
3. If matches sit in **content blocks**, say so: editing the block once fixes every email that includes it.
4. Applying edits through the API is switched off for now (see `applying` in the result). Give them the
   list as a checklist to work through in the platform, then suggest `/refresh` and `/check-campaign` on the
   changed live items to confirm.
