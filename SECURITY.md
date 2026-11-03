# Security

## What this tool can and can't touch
- **Read-only.** It never sends a message and never edits your account. `/bulk-edit` only previews.
- **No customer data.** It never calls user-export or profile endpoints. Personalization is tested with
  synthetic personas only.
- **Your keys stay on your machine.** Keys are entered through the plugin's settings (`/plugin configure
  crm-lifecycle-ops`); Claude Code keeps them in the system's secure storage and passes them only to this
  plugin's server, which sends them only to the platform's own API. Use read-only keys: the tool never
  needs write access, and a read-only key keeps that true even if the tool had a bug.
- **Snapshots stay local.** `/refresh` saves campaign, journey, segment and template data (your
  templates, never customer profiles) under `~/.crm-lifecycle-ops/snapshots/`. Delete the folder any time.
- **API calls are read-only.** Adapters only call list/details/report endpoints; there is no write code path.
- **Live link checks can't act as a recipient.** They use HEAD requests only and never request unsubscribe,
  preference-center or click-tracking links.
- **Local files:** `check_email` and `learn_from_email` read only `.html`/`.htm`/`.txt` files under 5 MB.
- **Local log only.** `~/.crm-lifecycle-ops/qa-log.jsonl` stores check ids and counts (never email content)
  to power `/ops-report`. Delete it any time.
- `/report-problem` shows you the exact issue text and asks before posting anything publicly.

## Reporting a vulnerability
Please **don't** open a public issue. Use GitHub's private reporting:
**Security → Report a vulnerability** on this repository. You'll get a reply within 7 days.
