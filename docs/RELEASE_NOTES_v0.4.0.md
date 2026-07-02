# projectmind v0.4.0 — first public release

Persistent, compact project memory for AI coding agents. Your agent reads one
~400-token digest instead of re-scanning the codebase every session — and a
local ledger shows you exactly how many tokens (and dollars) that saved.

## Highlights

- **Measured savings, not promises** — 78.9% (~1,541 tokens/session) on the
  reproducible benchmark (`npm run benchmark`); a gitignored local ledger
  records real savings as your agent works (`projectmind savings`), converted
  to dollars with zero config.
- **Session handoff** (unique to projectmind) — `mind_handoff` carries "what I
  was doing, what's next" across sessions, machines, and even different AI
  tools. It leads the next session's digest.
- **One-command wiring** — `projectmind setup` configures Claude Code, Cursor,
  Windsurf, Gemini CLI, Codex/AGENTS.md, and GitHub Copilot, idempotently.
- **Offline, enforced** — a CI test fails the build if any network API appears
  in the source. Two runtime dependencies. No telemetry, no LLM calls.
- **Trust mechanics** — atomic schema-validated writes, corruption self-heal
  with backups, drift detection (`doctor`), git-hook + watch-mode freshness.
- **Cross-platform** — CI on Linux, macOS, Windows × Node 18/20/22.
- **VS Code companion** — a status-bar counter showing your savings live
  (`integrations/vscode`, `.vsix` attached to this release).

## Install

```bash
npm install -g @nodemint/projectmind
cd your-repo
projectmind init --seed && projectmind setup
```

Full docs, benchmark methodology, and the trust FAQ: see the README.
