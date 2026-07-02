# projectmind — token savings (VS Code extension)

A tiny status-bar counter showing how many tokens (and dollars) projectmind has
saved your AI coding agent in this workspace.

```
✦ ~41.2k tokens saved
```

Hover for the breakdown (total, today, dollar estimate); click for details.

## How it works — and the privacy story

The projectmind MCP server keeps a **local ledger** (`.projectmind/ledger.json`,
gitignored) of every map read: tokens actually served vs. the estimated tokens
your agent would have burned scanning files instead. This extension **only reads
that one local JSON file**. It has zero dependencies, makes zero network calls,
and sends nothing anywhere — the same offline guarantee as projectmind itself
(enforced by a CI test in the main repo).

## Install

From this directory:

```bash
npx @vscode/vsce package          # produces projectmind-savings-0.1.0.vsix
code --install-extension projectmind-savings-0.1.0.vsix
```

The status item appears in any workspace containing a `.projectmind/` directory
and updates live as your agent works.

## Numbers are estimates

Token counts use the same honest heuristic as projectmind's benchmark:
`ceil(bytes / 4)`. The dollar figure uses the `savings.inputPricePerMTok` rate
from `.projectmind/config.json` — set it to your model's real input price.
