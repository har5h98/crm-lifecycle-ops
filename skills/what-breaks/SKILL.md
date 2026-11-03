---
name: what-breaks
description: Before changing or deleting something, see what depends on it. Attributes, segments, lists, content blocks, events, messages or any text/URL, with live items first and how each link is known. Use when someone asks what breaks in their CRM/marketing account if they change or delete an attribute, segment, list, content block, event or link, or where a segment, block or link is used in campaigns. Not for code.
argument-hint: "<the thing you want to change>"
---

# What breaks if I change this?

1. Work out the **kind** and **value**: attribute (`loyalty_tier`) · segment or list (`VIP members`) ·
   content-block (`footer_v2`) · event (`Order Placed`) · message · text (a phrase, promo code or URL).
   If unclear, `list_items` helps resolve names. Ask only if still ambiguous.
2. Needs a snapshot; if it's more than a day old, say so and offer `/refresh`.
3. `what_breaks`. Report:
   - **Headline**: "Changing `loyalty_tier` affects **N live** programs (and M drafts)."
   - **Live**: name · what it is · *how* it depends ("subject line uses it", "targets a segment that filters on it") ·
     how we know, in words: *confirmed by the API* / *read from the template* / *read from the segment's description* /
     *seen on screen <date>*.
   - **Not live**: one line.
   - **Can't rule out**: live items whose targeting the API doesn't expose, with why.
4. **Close the gaps** for "can't rule out" items (Braze mostly): offer to open each item's audience page
   in the person's browser with Claude in Chrome, read the targeted segments, and call `record_audience`
   for each (stored as *seen on screen*). One page at a time, only with their OK; never crawl the
   dashboard. Then re-run `what_breaks`.
5. End with a recommendation: safe to change · change with these updates first · don't change yet. Plus,
   for renames, the list of places to update.
