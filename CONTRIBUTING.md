# Contributing to projectmind

Thanks for helping make AI coding agents cheaper and smarter for everyone.

## Ground rules (the trust contract)

projectmind's value is that users can trust it. Every PR must preserve these
invariants — CI enforces most of them:

1. **Zero network calls in `src/`.** `test/offline.test.js` fails the build if
   any network API appears. There is no acceptable reason to add one.
2. **All savings/token numbers are labelled estimates**, with the methodology
   stated next to them. Never present an estimate as an exact count.
3. **Writes are atomic and schema-validated.** Anything that touches
   `.projectmind/` goes through `src/core` (temp file + fsync + rename).
4. **Two runtime dependencies** (`@modelcontextprotocol/sdk`, `picomatch`).
   Adding a dependency needs a very strong justification.
5. **Stack-agnostic.** No language-specific assumptions in core logic.

## Getting started

```bash
git clone https://github.com/Nodemint-dev/projectmind.git
cd projectmind
npm install
npm test            # 63 tests, node:test — must be green
npm run benchmark   # prints the estimated savings number
```

Tests run against temp directories only — never against a real repo. New
features need tests; bug fixes need a regression test.

## Project layout

- `src/core/` — the only code that touches `map.json`/`ledger.json` (schema,
  atomic IO, digest, seed, drift, context, handoff)
- `src/mcp/` — thin MCP adapter (stdio)
- `src/cli/` — thin CLI adapter
- `src/hooks/` — git post-commit updater + installer
- `src/setup/` — multi-agent config wiring
- `src/watch/` — fs.watch freshness updates
- `integrations/vscode/` — status-bar savings extension (not shipped to npm)

## Pull requests

- Keep PRs focused; one change per PR.
- `npm test` green on your platform; CI covers Linux/macOS/Windows × Node 18/20/22.
- Update `CHANGELOG.md` under an `Unreleased` heading.
- If you change the map schema, bump carefully and add migration notes — maps
  live in users' repos.

## Reporting bugs / requesting features

Use the issue templates. For bugs, `projectmind validate` and `projectmind
stats` output plus your OS/Node version make triage much faster.
