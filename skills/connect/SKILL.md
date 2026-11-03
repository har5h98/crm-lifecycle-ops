---
name: connect
description: Connect a Braze, Klaviyo or Iterable account with a read-only API key, safely. Use when someone says "connect Braze", "set up Klaviyo", "add my Iterable account" or a command says an account isn't connected.
argument-hint: "[braze | klaviyo | iterable]"
---

# Connect an account

**Never ask the person to paste an API key into the chat.** Keys go in environment variables on their
machine; this tool reads them and never stores or prints them.

1. Run `connection_status` to see what's already connected.
2. For the platform they want, walk them through creating a **read-only** key:
   - **Braze**: Settings → APIs and Identifiers → Create API key. Tick only: `campaigns.list`,
     `campaigns.details`, `campaigns.data_series`, `canvas.list`, `canvas.details`, `canvas.data_summary`,
     `segments.list`, `segments.details`, `content_blocks.list`, `content_blocks.info`.
     Also note their REST endpoint (Settings → APIs, e.g. `https://rest.iad-01.braze.com`).
   - **Klaviyo**: Settings → API keys → Create Private API Key → *Read-only access*.
   - **Iterable**: Integrations → API keys → New key → type *Server-side*, read access. Note whether the
     project is in the US or EU data center.
3. Tell them where to put it: run **`/plugin configure crm-lifecycle-ops`** and fill in that platform's
   fields (key, plus the REST endpoint for Braze or the data center for Iterable, and an optional label).
   Claude Code keeps the keys in the system's secure storage (the macOS Keychain on a Mac) and passes them
   only to this plugin's server. Then restart Claude Code (or reload plugins).
   Running the server outside the plugin? It also reads `BRAZE_API_KEY`, `BRAZE_REST_ENDPOINT`,
   `KLAVIYO_API_KEY`, `ITERABLE_API_KEY` from the environment. Avoid putting keys in
   `~/.claude/settings.json` "env", which hands them to every session and command.
4. After restarting, run `connection_status` with `test: true` and report the result in one line.
5. Next step: `/refresh` to take the first snapshot.

No account handy? `/refresh` with the demo account (a fictional brand) shows everything working.
