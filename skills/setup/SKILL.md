---
name: setup
description: First-time setup. Learns what "right" means for this team (language and spelling, brand terms, link domains and UTM convention, legal footer, senders, test personas, style, how strict to be) and saves it as house rules every check uses. Use on first install of crm-lifecycle-ops, or when someone wants to set up, personalize or teach it their team's email/SMS/push conventions.
---

# Set up house rules

Goal: a rulebook that makes every check judge emails the way *this* team does. Some things are wrong
for everyone (no unsubscribe, broken template syntax). Those are locked and need no setup. Everything
else depends on the team, so ask.

Keep it light: **4–5 short rounds, at most 4 questions each**, each with a sensible default the person can
accept. Use the AskUserQuestion tool when available. Skip anything they've already told you.
Start with `get_house_rules` and, if a rulebook exists, offer to review it instead of starting over.

## Round 1: basics
1. Which platforms? (Braze / Klaviyo / Iterable)
2. Brand or team name, exactly as it should be written.
3. Language and spelling: US English (default) · UK/GB English · other language(s). If they send in
   several languages, note them; copy review will run per language.
4. Where do recipients live? (US · Canada · EU · UK · Australia · other). This decides the legal footer:
   US CAN-SPAM needs a postal address; Canada (CASL) and the EU/UK need clear sender identity and consent-based unsubscribe.

## Round 2: learn from a good email (the fastest way to capture conventions)
Ask: *"Paste one or two emails you'd happily send today (HTML), with subject and sender if you have them."*
Run `learn_from_email` on each, then show what you found as plain proposals and ask which to keep:
- "Links go to **fernbrook.example**. Only allow these domains?"
- "Every link has **utm_source=braze, utm_medium=email, utm_campaign=<snake_case>**. Require that?"
  (Turn observed values into a pattern: fixed value → `^braze$`; varied snake_case → `^[a-z0-9_]+$`.)
- "Sender is **hello@fernbrook.example**. Approved senders: that address, or the whole domain?"
- "Footer has **100 Example Way, Springfield**. Require it in every email?"
- "Name fallback is **'there'**. Make that the standard?" and "Spelling looks **US**. Confirm?"
If they have no example handy, ask these as direct questions instead.

## Round 3: brand and style
1. Product or brand terms people often get wrong (e.g. "e-mail → email", "Fernbrook market → Fernbrook Market").
2. Words or phrases never to use (e.g. "act now", "guaranteed").
3. Subject line: max length (default 60) · emoji allowed / warn / block · max exclamation marks.
4. Tone in three words (used only for the advisory copy review).

## Round 3b: channels (ask only about the channels they use)
1. Which channels? Email · push · SMS · in-app.
2. **Push**: the app's deep-link format (e.g. `fernbrook://` or `https://brand.example/app/`), whether every
   push must have one, and length limits (defaults: title 40, body 120).
3. **SMS**: max billed segments (default 2); does the platform append "Reply STOP" automatically, or must
   it be in the copy (default: in the copy); must every text start with the brand name (default yes).
4. **In-app**: max body length (default 150); must every message have a button.

## Round 4: personalization and strictness
1. The attributes they personalize with most (e.g. first_name, loyalty_tier, city). Build 3–4 **synthetic**
   test personas from them, always including one with everything blank and one with long/accented values.
   Never ask for or use real customer data.
2. How strict? **Strict** (warnings block a send: UTMs, off-domain links, brand terms → fail) ·
   **Balanced** (default) · **Relaxed** (cosmetic checks → info: preheader, alt text, http).
3. Campaign naming convention, if any (e.g. `LC_<channel>_<audience>_<YYYYMM>`), turned into a regex + example.

## Save
Summarize the whole rulebook in plain English (one line per rule), show it, and ask for a yes. Then
`save_house_rules` with the full object (start from `get_house_rules().rules` and fill in fields).
Tell them:
- where it's saved, and that `/house-rules` changes it any time;
- **to share it with the team**, put the file somewhere shared (a repo or drive) and set
  `CLO_RULES=/path/to/rules.json` for everyone, so everyone's emails are judged by the same rules.

Finish with: *"Try it: paste an email and run `/check-email`."*
