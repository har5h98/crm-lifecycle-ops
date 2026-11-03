# Security

## What this tool can and can't touch
- **Read-only.** It never sends a message and never edits your account. `/bulk-edit` only previews.
- **No customer data.** It never calls user-export or profile endpoints. Personalization is tested with
  synthetic personas only.
- **Your keys stay on your machine.** API keys are read from environment variables or your OS keychain,
  never written to the repo or sent anywhere except the platform's own API.
- **Snapshots stay local.** `/refresh` saves campaign, journey, segment and template data (your
  templates, never customer profiles) under `~/.crm-lifecycle-ops/snapshots/`. Delete the folder any time.
- **API calls are read-only.** Adapters only call list/details/report endpoints; there is no write code path.
- **Local log only.** `~/.crm-lifecycle-ops/qa-log.jsonl` stores check ids and counts (never email content)
  to power `/ops-report`. Delete it any time.
- `/report-problem` shows you the exact issue text and asks before posting anything publicly.

## Reporting a vulnerability
Please **don't** open a public issue. Use GitHub's private reporting:
**Security → Report a vulnerability** on this repository. You'll get a reply within 7 days.
