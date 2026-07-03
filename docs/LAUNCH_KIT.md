# Launch kit — copy-paste submissions & posts

Everything below is ready to submit. Order matters: directories first (they're
where MCP users actually browse), social after (drives a spike; directories
catch the long tail).

---

## 1. MCP directories

### Official MCP Registry (registry.modelcontextprotocol.io — highest value)

The old README-list-PR process is gone; the official path is now the MCP
Registry, published via CLI. Prereqs are already in the repo (`server.json`,
`mcpName` in package.json) — after `npm publish` of v0.4.1, run:

```bash
brew install mcp-publisher
cd "/Users/shannirmala/Documents/Web Projects/projectmind"
mcp-publisher login github     # browser must be signed in as Nodemint-dev
mcp-publisher publish
# verify:
curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=projectmind"
```

Note: the registry verifies ownership by checking that the *published* npm
package's `mcpName` matches `server.json`'s `name` — so v0.4.1 must be on npm
before `mcp-publisher publish` will succeed.

### mcp.so
Submit at https://mcp.so/submit — Name: `projectmind` · Repo:
`https://github.com/Nodemint-dev/projectmind` · Install: `npx -y @nodemint/projectmind mcp`

Description (short): *Persistent project memory for AI coding agents. One
~400-token digest replaces codebase re-scanning every session; a local
gitignored ledger shows exactly how many tokens and dollars it saved you.
Session handoff carries "what I was doing" across sessions and tools. 100%
offline — enforced by a CI test, not a promise.*

### Smithery (smithery.ai) and PulseMCP (pulsemcp.com)
Same blurb and metadata as mcp.so; both have web submission forms.

### Awesome lists
- `awesome-claude-code`, `awesome-cursorrules`/`awesome-cursor`, `awesome-mcp-servers`:
  same one-line entry as the official list, adapted to each list's format.

---

## 2. Show HN

**Title:** `Show HN: Projectmind – project memory for AI coding agents, with measured token savings`

**Text:**

Every AI coding session starts amnesiac: the agent re-reads your codebase,
re-derives your architecture, or asks you to re-explain decisions — and you pay
for that in tokens every single day.

projectmind is an MCP server + CLI that keeps a compact, structured project map
in your repo (modules, dependencies, decisions, conventions, glossary). The
agent reads one ~400-token digest at session start instead of scanning files,
drills into single modules on demand, and writes back what it learns. The map
is git-committed, so it's shared across your team and across tools (Claude
Code, Cursor, Windsurf, Gemini CLI, Copilot).

Three things I tried to do differently:

1. Measured claims, not vibes. There's a reproducible benchmark in the repo
   (78.9% fewer tokens per session-start on the fixture project), and a local
   ledger records your actual savings as the agent works — `projectmind
   savings` shows tokens and an estimated dollar figure, with the methodology
   printed next to every number. There's also a tiny VS Code extension that
   puts the counter in your status bar.

2. Trust as a test, not a promise. It's fully offline — no LLM calls, no
   telemetry, two runtime dependencies — and CI fails if any network API
   appears in the source tree.

3. Session handoff. The agent leaves a one-line "what I was doing, what's
   next" note before a session ends; it leads the next session's digest —
   across machines and even across different AI tools.

It's deliberately NOT a code parser — tools like tree-sitter-based code graphs
capture structure well; projectmind captures the intent layer they can't (why
JWT over sessions, "money is integer cents"), and it points agents at codegraph
for symbol-level detail when both are installed.

Install: `npm i -g @nodemint/projectmind` then `projectmind init --seed &&
projectmind setup` in your repo.

Repo: https://github.com/Nodemint-dev/projectmind — would love feedback,
especially on the digest format and the savings methodology.

---

## 3. r/ClaudeAI

**Title:** `I built an MCP server that gives Claude Code persistent project memory — and shows you exactly how many tokens it saved`

**Body:**

The problem: every session, Claude re-reads half my codebase to remember what
the project even is. Multiply by every teammate, every day.

projectmind keeps a structured map of your project in the repo
(`.projectmind/map.json`): modules, dependencies, architectural decisions,
conventions, glossary. Claude reads a ~400-token digest first (`mind_digest`),
queries single modules when needed (`mind_query`), and records decisions it
makes (`mind_update`) so the next session doesn't rediscover them.

The parts I haven't seen elsewhere:

- **A savings ledger.** Every map read records tokens-served vs. the estimated
  tokens of the files Claude would have read instead. `projectmind savings`
  shows your running total (tokens + dollars, labelled estimates, methodology
  shown). There's a VS Code status-bar counter too.
- **Session handoff.** Claude calls `mind_handoff` before the session ends
  ("adding refunds to orders-route; next: write tests") and that note leads the
  next session's digest. Works across machines and even across different AI
  tools, since the map is just committed JSON + MCP.
- **CI-enforced offline.** A test fails the build if any network API shows up
  in src/. No telemetry, no LLM calls, 2 dependencies.

`projectmind setup` wires it into Claude Code (and Cursor/Windsurf/Gemini/
Copilot) in one command. MIT, 63 tests, Linux/macOS/Windows.

https://github.com/Nodemint-dev/projectmind

**r/cursor variant:** same body; swap the Claude references for Cursor and lead
with `.cursor/mcp.json` + `.cursorrules` being auto-configured by `setup`.

---

## 4. X / Twitter thread

1/ Your AI coding agent has amnesia. Every session it re-reads your codebase to
relearn what your project is — and you pay for that in tokens. Every day.

2/ So I built projectmind: a persistent, compact project map that lives in your
repo. Your agent reads ~400 tokens instead of re-scanning everything. On our
benchmark: 78.9% fewer tokens per session start.

3/ And it doesn't ask you to trust it — it shows you. A local ledger records
every read: tokens served vs. what the agent would have read instead. Status
bar counter in VS Code. All estimates labelled, methodology printed.

4/ My favorite part: session handoff. The agent leaves a note — "adding refunds
to orders-route, next: tests" — and it leads the next session's digest.
Tomorrow, on another machine, in a different AI tool. It just resumes.

5/ Fully offline, enforced by CI (the build fails if a network API appears in
src). Two dependencies. MIT. Works with Claude Code, Cursor, Windsurf, Gemini,
Copilot — one `projectmind setup` command wires them all.

6/ npm i -g @nodemint/projectmind
   projectmind init --seed && projectmind setup
   → https://github.com/Nodemint-dev/projectmind

---

## 5. Timing & sequencing

- Directories: submit any time, today.
- Show HN: weekday morning US time works best; have the repo README polished
  and reply to every comment in the first 2 hours.
- Reddit: don't post the same day as HN; space by a couple of days.
- After the first feedback wave, cut a v0.4.x with fixes and mention it in the
  threads — visible responsiveness converts watchers into users.
