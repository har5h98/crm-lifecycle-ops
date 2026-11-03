# Privacy policy

*Last updated: November 3, 2026*

crm-lifecycle-ops is an open-source plugin that runs entirely on your computer. The author runs no server and
receives no data from it.

## What it reads
- **Your marketing platform account** (Braze, Klaviyo or Iterable), through read-only API calls you authorize
  with your own key: campaigns, journeys, segment and list definitions, message templates and content blocks,
  and aggregate delivery statistics. Message content can include sender names and addresses.
- **It does not read customer profiles** or any individual recipient's data. Personalization is tested with
  made-up customers.
- **Files you point it at**: email HTML or text files (`.html`, `.htm`, `.txt`) you ask it to check.

## What it stores, and where
All on your computer, under `~/.crm-lifecycle-ops/`:
- account snapshots (the campaign and template data above), keeping the 30 newest;
- your team's house rules;
- a usage log of which checks ran and how many problems they found, never message content.

If you set a *team report folder*, the usage log (counts and check ids only) is also written there.
Delete any of these files at any time; the plugin keeps no other copies.

## Where data goes
- API keys are stored by Claude Code in your system's secure storage and sent only to the platform you connected.
- Read requests go only to that platform's API.
- Optional live link checks send HEAD requests to links inside the email being checked; unsubscribe and
  click-tracking links are never requested.
- `/report-problem` creates a public GitHub issue only after you approve its exact text.
- Nothing is sent to the author or any other third party. Your conversation with Claude is governed by
  Anthropic's own terms and privacy policy.

## Retention
The author retains nothing. Local files stay until you delete them.

## Contact
Open an issue at https://github.com/har5h98/crm-lifecycle-ops/issues, or report security concerns privately
under **Security → Report a vulnerability** on the repository.
