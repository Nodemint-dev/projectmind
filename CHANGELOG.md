# Changelog

All notable changes to this project are documented here. This project adheres
to [Semantic Versioning](https://semver.org/).

## [0.4.4] - 2026-07-04

### Changed
- Strengthened `mind_digest`/`mind_context` tool descriptions and the
  `setup`-generated rules block (`CLAUDE.md` etc.) to name the exact trigger
  explicitly — "before running ls/find/glob/grep or reading files" — instead
  of the vaguer "before reading source files," which real usage showed models
  don't always map to directory listing.

**Honesty note:** this is a best-effort prompt-engineering improvement, not a
guarantee. No MCP server (this one included) can force a model to call a
specific tool — the agent still weighs the nudge against its own instincts.
If you see an agent skip `mind_digest` on an orientation question, that's a
known, inherent limit of instruction-following, not a wiring bug — verify the
tool itself works by asking the agent to call it directly.

## [0.4.3] - 2026-07-03

### Added
- **`projectmind setup --global`** — registers the MCP server once for every
  future project, instead of per-repo `.mcp.json`. For Claude Code this shells
  out to `claude mcp add --scope user` (the same mechanism codegraph and other
  tools use for global registration) rather than hand-editing its internal
  config; Cursor, Windsurf, and Gemini CLI get the same idempotent merge into
  their global config files (`~/.cursor/mcp.json`,
  `~/.codeium/windsurf/mcp_config.json`, `~/.gemini/settings.json`).

Prompted by real dogfooding: without this, a fresh project needed
`projectmind setup` run every time, unlike globally-registered MCP servers.
Rules files (`CLAUDE.md` etc.) intentionally stay per-project — there's no
sane "global" convention text — so `--global` only wires the server itself.

## [0.4.2] - 2026-07-03

### Fixed
- MCP Registry namespace casing: `mcpName` must match the GitHub account
  exactly (`io.github.Nodemint-dev/projectmind`); the registry compares it
  case-sensitively against the published npm package.

## [0.4.1] - 2026-07-03

### Added
- `projectmind mcp` subcommand — runs the stdio MCP server via the main bin,
  so `npx @nodemint/projectmind mcp` works (required by the official MCP
  Registry, whose clients invoke the package's default binary).
- `mcpName` field in package.json and a `server.json` — the ownership
  handshake for publishing to registry.modelcontextprotocol.io.

## [0.4.0] - 2026-07-02

> Published to npm as **`@nodemint/projectmind`** — the registry blocked the
> bare name as too similar to an existing `project-mind` package. The CLI
> commands are unchanged: `projectmind` and `projectmind-mcp`.

### Added
- **Session handoff** — the feature no comparable tool has. `mind_handoff`
  (MCP) / `projectmind handoff` (CLI) records "what I was doing, what's next";
  the note leads the next session's digest and lives in the gitignored local
  overlay. Agents are prompted (via the `setup` rules block) to leave one before
  a session ends or compacts.
- **Zero-config dollar savings** — no one sets a price by hand, so the ledger
  now converts to dollars out of the box using a built-in table of published
  input rates (Haiku $1 / Sonnet $3 / Opus $5 / Fable $10 per MTok, as of
  June 2026), defaulting to Sonnet tier and labelling the assumption on every
  number. `savings.model` or `savings.inputPricePerMTok` override it.
- **Cross-platform proof** — CI matrix expanded to Linux + macOS + Windows ×
  Node 18/20/22; suite additionally verified on Linux (Debian, Node 18 & 20)
  via Docker during development. macOS verified natively.

### Changed
- `config.savings` default is now `{ "model": "sonnet" }` (was a raw
  `inputPricePerMTok`); existing explicit rates still win.

## [0.3.0] - 2026-07-02

The "prove it" release: measurable savings, a visible counter, and a trust
guarantee that CI enforces instead of the README merely claiming.

### Added
- **Savings ledger**: the MCP server records every map read — tokens served vs.
  the estimated tokens of the files the agent would have read instead — into a
  local, gitignored `.projectmind/ledger.json`. All numbers labelled estimates;
  savings floored at zero; corrupt ledger self-heals.
- **`projectmind savings`**: totals, today, per-tool breakdown, 7-day bars, and
  an optional dollar conversion via `savings.inputPricePerMTok` in config.
- **`mind_stats`** now includes the savings summary, so agents can report
  savings to the user.
- **VS Code extension** (`integrations/vscode`): a status-bar counter
  (`✦ ~20.5k tokens saved`) that reads the local ledger. Zero dependencies,
  zero network, activates only in workspaces with `.projectmind/`.
- **Offline guarantee, enforced**: `test/offline.test.js` fails CI if any
  network API appears anywhere in `src/`. The privacy claim is now a test, not
  a promise.
- **README overhaul**: benchmark + savings visuals (light/dark SVGs), mermaid
  architecture diagram, real captured outputs, comparison table, trust FAQ.

## [0.2.0] - 2026-07-01

Adoption and "surgical context" release. projectmind stays the curated *intent*
layer (decisions, conventions, module purpose) and now complements structural
tools like codegraph instead of competing with them.

### Added
- **Multi-agent setup** (`projectmind setup`): idempotently wires the MCP server
  and a workflow rules block into Claude Code, Cursor, Windsurf, Gemini CLI,
  Codex/`AGENTS.md`, and GitHub Copilot. JSON configs are *merged* (existing
  servers preserved); an unparseable config is backed up and skipped, never
  clobbered.
- **Auto-seed** (`projectmind seed`, `projectmind init --seed`): deterministic
  starter map from repo layout — project name/description, detected stack, and a
  node per top-level source directory. Never overwrites curated nodes. No LLM.
- **Watch mode** (`projectmind watch`): live file→module freshness on save via
  `fs.watch`, debounced, zero-LLM. Same reconcile logic as the git hook.
- **Task-scoped context** (`mind_context` tool, `projectmind context`): given the
  files you're editing (or a node/keyword), returns only the relevant subgraph —
  those modules in full plus their direct dependencies. The most token-cheap
  read path.
- **Drift detection** (`projectmind doctor`, folded into `validate`): flags nodes
  whose file globs match nothing on disk, and nodes untouched past a threshold.
- **codegraph awareness**: if a `.codegraph/` index exists, `mind_digest`,
  `mind_query`, and `mind_context` point the agent to codegraph for symbol-level
  detail. Detection only — no dependency, no duplication.
- **Stack detection** (`detectStack`) from manifests (package.json, pubspec.yaml,
  go.mod, Cargo.toml, pyproject, and more).

## [0.1.0] - 2026-07-01

Initial release.

### Added
- **Core library** (`src/core`): atomic writes (temp + fsync + rename), schema
  validation before every write, corruption self-heal with `.corrupt-*` backups,
  deterministic serialization (sorted keys), and the full map API — `init`,
  `load`, `save`, `patch`, `query`, `search`, `digest`/`buildDigest`,
  `validate`, `stats`, `estimateTokens`.
- **Compact digest** with active/stable sectioning, `notes`/`rationale`
  exclusion, deprecated-node exclusion, and constant-size grouping for large
  projects (past `config.maxNodes`).
- **MCP server** (`projectmind-mcp`, stdio): `mind_digest`, `mind_query`,
  `mind_search`, `mind_update`, `mind_stats`. Errors return as content, never
  crash the transport.
- **CLI** (`projectmind`): init, digest, query, search, add-node, add-edge,
  decide, convention, stats, validate, install-hook.
- **Git post-commit hook**: deterministic file→module freshness updates on
  commit, installed idempotently, never fails a commit.
- **Repo + local scopes**: `map.json` (committed) merged with a gitignored
  `map.local.json` overlay in the read view.
- **Benchmark** on a realistic fixture proving estimated token savings.
- Test suite (`node:test`) covering validation, patch semantics, digest rules,
  atomic-write/corruption safety, scope merge, glob matching, round-trip
  determinism, an MCP smoke test, and benchmark sanity.
