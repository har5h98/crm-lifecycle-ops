# Contributing

Thanks for helping. The most valuable contribution is a **wrong result**, so start there.

## Found a false alarm or a missed problem?
Run `/report-problem` in Claude (it strips private details and drafts the issue), or open a
[Wrong result issue](../../issues/new?template=wrong-result.yml) by hand.

## How fixes land
1. The reported case is added to `tests/corpus/<short-name>/` (`email.html` + `case.json`) **first**,
   so the test fails.
2. The check is fixed until the whole corpus passes.
3. One pull request per fix. Every merged fix keeps its corpus case forever.

## Local setup
```bash
npm install
npm run check   # typecheck + tests + build
```
`dist/mcp-server.js` is committed (plugins install straight from GitHub without a build step), so run
`npm run build` and commit the result with any change under `src/`. CI fails if it's stale.

## Rules
- **No real data**: no customer data, no real company's templates or account exports. Use the
  fictional brand "Fernbrook Market" and `.example` domains.
- New check → add it to `src/checks/catalog.ts` (a test enforces this) and add corpus cases that
  show it firing and not firing.
- Pass/fail decisions are deterministic code. AI output may explain or advise, never decide.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org) (`fix:`, `feat:`,
  `docs:`…); releases and the changelog are generated from them.

By contributing you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Releases

Merging the release PR (opened by release-please) tags the version and then publishes it to npm and the
official MCP Registry from GitHub Actions (`.github/workflows/release.yml`). No tokens are stored: both
accept the workflow's GitHub identity. The version in `package.json`, `server.json` and the plugin manifest
is bumped together.

