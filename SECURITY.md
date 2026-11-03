# Security

## What this tool can and can't touch
- **Read-only by default.** It never sends a message. Anything that would change your account
  (planned for `/bulk-edit`) shows a preview diff first and needs an explicit yes.
- **No customer data.** It never calls user-export or profile endpoints. Personalization is tested with
  synthetic personas only.
- **Your keys stay on your machine.** API keys are read from environment variables or your OS keychain,
  never written to the repo or sent anywhere except the platform's own API.
- **Local log only.** `~/.crm-lifecycle-ops/qa-log.jsonl` stores check ids and counts (never email content)
  to power `/ops-report`. Delete it any time.
- `/report-problem` shows you the exact issue text and asks before posting anything publicly.

## Reporting a vulnerability
Please **don't** open a public issue. Use GitHub's private reporting:
**Security → Report a vulnerability** on this repository. You'll get a reply within 7 days.
