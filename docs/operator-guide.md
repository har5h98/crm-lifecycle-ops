# Operator guide

A one-page routine for campaign operators and the lead who sets the tool up. No technical background needed.

## One-time setup (lead, about 15 minutes)

1. **Install** in Claude Code: `/plugin marketplace add har5h98/crm-lifecycle-ops`, then
   `/plugin install crm-lifecycle-ops@crm-lifecycle-ops`.
2. **Connect** (`/connect`): create a **read-only** API key in Braze, Klaviyo or Iterable and enter it in
   `/plugin configure crm-lifecycle-ops`. Keys go to your computer's secure storage, never into chat.
3. **Teach it your rules** (`/setup`): paste one or two emails you'd happily send today; it reads off your
   domains, UTM convention, sender, footer and name fallback, then asks a few questions (spelling, brand terms,
   SMS and push limits, how strict to be).
4. **Share the rules with the team**: save the rules file somewhere everyone can reach and point each person's
   setup at it, so everyone is checked against the same standard.
5. **Optional, team reporting**: set the same *team report folder* (a synced drive) for everyone in
   `/plugin configure`. Only counts are shared, never message content.

## Every build

| When | Do this | Command |
|---|---|---|
| Planning a new journey | Check who else already targets these people or this trigger | `/plan-journey` |
| Starting the build | Get click-by-click steps in your platform's terms, with your naming and UTMs | `/build-plan` |
| Changing something that's live | See what else it affects, then get the safe way to change it | `/what-breaks`, then `/edit-plan` |
| Copy is drafted | Check each message as you go | `/check-email`, `/check-push`, `/check-sms`, `/check-in-app` |
| Build is finished | Check the whole campaign or journey, every channel, before sending | `/check-campaign <name>` |
| 1 hour and 24 hours after launch | Check delivery health | `/watch-launch <name>` |

## Reading a result

- 🔴 **Don't send**: something is wrong for everyone (no unsubscribe, broken personalization, a staging link). Fix it.
- 🟡 **Fix before sending**: probably wrong (missing UTMs, too many SMS segments, a long push title). Fix it,
  or decide it's fine for your team.
- 🟢 **Ready**: nothing blocking. Still read the *advisory* copy notes and the *What I couldn't check* list.

**Disagree with a finding?**
- *It's fine for our team* → `/house-rules` records an exception with your reason (it stays visible as "waived").
- *The tool got it wrong* → `/report-problem` turns it into a test case and a fix.

## Every week (lead)

1. `/refresh` (or schedule it daily) and `/what-changed`: catch edits nobody announced.
2. `/ops-report` (add *team* for everyone): problems caught before send, most common issues, hours saved.
   Use the most common issue to fix the root cause, for example a template missing UTMs.
3. Skim any open `/report-problem` issues.

## What it never does

It never sends a message, never edits your account, and never reads customer profiles; it tests with made-up
customers. Build and edit plans tell a person what to click; the person does the clicking.
