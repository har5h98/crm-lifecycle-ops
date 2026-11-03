---
name: house-rules
description: View or change the team's house rules. Allow or block emoji, add a brand term, change the subject limit or UTM convention, make a check stricter or quieter, or mark a finding as "fine for us". Use when someone reacts to a crm-lifecycle-ops finding ("that's fine for us", "stop flagging X", "make X a blocker") or asks to see or change the team's QA house rules.
argument-hint: "[what to change]"
---

# House rules

1. `get_house_rules`. If they asked to *see* the rules, summarize them in plain English, grouped as
   language & spelling · brand · links & UTMs · legal footer · senders · personas · style · strictness ·
   exceptions. Mention that the locked checks (from the response) apply to everyone and can't change.
2. To change something, work out the smallest edit, show it as **before → after**, and ask for a yes.
   Then `save_house_rules` with the full updated object.
3. **"This finding is fine for us"** → `add_exception` with the check id, a short `match` so it only
   covers this case (e.g. the domain or phrase), and their reason in their words. Exceptions are listed
   in every report as *waived*, never hidden.
   - If the finding is *factually wrong* (the tool misread the email), that's a bug, not a house rule:
     suggest `/report-problem` instead.
   - Locked checks can't be waived; explain why in one line (they're wrong for every team).
4. Strictness: change `severity` for a check id (`fail` / `warn` / `info` / `off`); `list_checks` has the ids.

If the rules live in a shared file (the **Shared rules file** setting), remind them the change applies to the whole team.
