#!/usr/bin/env node
// Human-facing CLI. A thin adapter: argv -> core function -> stdout.
import * as core from "../core/index.js";
import { installHook } from "../hooks/install.js";
import { setupAgents, SUPPORTED_AGENTS } from "../setup/index.js";
import { watch } from "../watch/index.js";
import { savingsSummary, resolvePrice } from "../core/ledger.js";

const HELP = `projectmind — persistent, compact project memory for AI coding agents

Usage: projectmind <command> [args]

Commands:
  init [--seed]                 Scaffold .projectmind/; --seed proposes a starter map from repo layout
  seed                          Propose a starter map from repo layout (adds missing nodes only)
  setup [--agent <name>]        Wire the MCP server + rules into agents (${SUPPORTED_AGENTS.join(", ")}, or all)
  digest                        Print the compact digest (what the agent reads first)
  context [--files a,b] [--node id] [--term t] [--depth 1]   Task-scoped subgraph
  query <id>                    Full detail for one node (files, notes, edges)
  search <term>                 Find nodes/decisions/glossary by keyword
  add-node <id> <summary> [status]   Add or update a node (status: active|stable|deprecated)
  add-edge <from> <to> <rel>    Add a dependency edge
  decide <text> [rationale]     Record an architectural decision
  convention <text>             Record a project convention
  handoff [note] [--clear]      Leave/show/clear a "resume here" note that leads the next digest
  stats                         Map sizes + estimated digest tokens
  savings                       Estimated tokens/dollars saved (local ledger; never leaves your machine)
  validate                      Check map integrity, report errors
  doctor                        Report drift: nodes pointing at missing files, or gone stale
  watch                         Live-update file→module freshness on save (Ctrl-C to stop)
  install-hook                  Install the git post-commit auto-updater
  mcp                           Run the MCP server on stdio (what agents connect to)

Options:
  --local                       Write to the per-developer overlay (map.local.json)
  --root <dir>                  Operate on a specific project root
  --seed                        (init) seed a starter map after scaffolding
  --agent <name>                (setup) target one agent; default all
  --files <a,b,c>               (context) comma-separated files you're working on
  --node <id>                   (context) seed the subgraph from this node
  --term <t>                    (context) seed the subgraph from a keyword
  --depth <n>                   (context) neighbor expansion depth (default 1)
  --stale <days>                (doctor) staleness threshold in days (default 90)
  --clear                       (handoff) clear the current handoff note
  -h, --help                    Show this help
`;

function parseArgs(argv) {
  const opts = { local: false, root: undefined, seed: false, depth: 1, stale: 90 };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--local") opts.local = true;
    else if (a === "--seed") opts.seed = true;
    else if (a === "--root") opts.root = argv[++i];
    else if (a === "--agent") opts.agent = argv[++i];
    else if (a === "--files") opts.files = argv[++i];
    else if (a === "--node") opts.node = argv[++i];
    else if (a === "--term") opts.term = argv[++i];
    else if (a === "--depth") opts.depth = Number(argv[++i]);
    else if (a === "--stale") opts.stale = Number(argv[++i]);
    else if (a === "--clear") opts.clear = true;
    else if (a === "-h" || a === "--help") opts.help = true;
    else rest.push(a);
  }
  return { opts, rest };
}

function out(obj) {
  process.stdout.write(typeof obj === "string" ? obj : JSON.stringify(obj, null, 2));
  process.stdout.write("\n");
}

async function main() {
  const { opts, rest } = parseArgs(process.argv.slice(2));
  const cmd = rest.shift();
  if (!cmd || opts.help) { out(HELP); return; }

  // `projectmind mcp` starts the stdio MCP server — the entrypoint MCP
  // registry clients use (npx @nodemint/projectmind mcp). Must not write
  // anything to stdout itself; the transport owns it.
  if (cmd === "mcp") {
    await import("../mcp/server.js");
    return;
  }

  const r = opts.root ? core.root(opts.root) : core.root();
  const scope = opts.local ? "local" : undefined; // undefined => config default (repo)
  const patchOpts = scope ? { scope } : {};

  switch (cmd) {
    case "init": {
      core.init(r);
      out(`Initialized .projectmind/ at ${r}`);
      if (opts.seed) {
        const res = core.seed(r);
        out(`Seeded ${res.added.length} node(s) from repo layout: ${res.added.join(", ") || "(none)"}`);
      }
      out(core.digest(r));
      break;
    }
    case "seed": {
      const res = core.seed(r);
      out(`Added ${res.added.length} node(s): ${res.added.join(", ") || "(none — map already covers the source dirs)"}`);
      out(`Detected stack: ${res.stack.join(", ") || "(none)"}`);
      out("Refine the placeholder summaries with add-node or mind_update.");
      break;
    }
    case "setup": {
      const agents = opts.agent || "all";
      const results = setupAgents(r, agents);
      out(`Wired projectmind into agents at ${r}:`);
      for (const x of results) out(`  ${x.status.padEnd(18)} ${x.file}`);
      out("\nRestart your agent so it picks up the new MCP server.");
      break;
    }
    case "digest":
      out(core.digest(r));
      break;
    case "context": {
      const selector = {};
      if (opts.files) selector.files = opts.files.split(",").map((s) => s.trim()).filter(Boolean);
      if (opts.node) selector.node = opts.node;
      if (opts.term) selector.term = opts.term;
      if (!selector.files && !selector.node && !selector.term && rest.length) selector.files = rest;
      out(core.context(selector, r, { depth: opts.depth }));
      break;
    }
    case "doctor": {
      const d = core.drift(r, { staleDays: opts.stale });
      if (!d.dangling.length && !d.stale.length) { out("No drift detected — every node maps to real files and looks fresh."); break; }
      if (d.dangling.length) {
        out("Nodes pointing at files that no longer exist:");
        for (const x of d.dangling) out(`  - ${x.id} (globs: ${x.files.join(", ")})`);
      }
      if (d.stale.length) {
        out(`Nodes untouched for more than ${opts.stale} days:`);
        for (const x of d.stale) out(`  - ${x.id} (last touched ${x.lastTouched}, ${x.days} days ago)`);
      }
      break;
    }
    case "watch": {
      out(`Watching ${r} for changes (Ctrl-C to stop)...`);
      const controller = new AbortController();
      watch(r, {
        signal: controller.signal,
        onUpdate: (ids) => process.stdout.write(`[projectmind] freshened: ${ids.join(", ")}\n`),
      });
      process.on("SIGINT", () => { controller.abort(); process.exit(0); });
      break;
    }
    case "query": {
      const node = core.query(rest[0], r);
      if (!node) { out(`No node: ${rest[0]}`); process.exitCode = 1; break; }
      out(node);
      break;
    }
    case "search": {
      const hits = core.search(rest.join(" "), r);
      out(hits.length ? hits : `No matches for "${rest.join(" ")}"`);
      break;
    }
    case "add-node": {
      const [id, summary, status] = rest;
      if (!id || !summary) { out("Usage: add-node <id> <summary> [status]"); process.exitCode = 1; break; }
      const node = { id, summary };
      if (status) node.status = status;
      core.patch({ node }, r, patchOpts);
      warnLongSummaries(r);
      out(`Saved node "${id}"`);
      break;
    }
    case "add-edge": {
      const [from, to, rel] = rest;
      if (!from || !to || !rel) { out("Usage: add-edge <from> <to> <rel>"); process.exitCode = 1; break; }
      core.patch({ edge: { from, to, rel } }, r, patchOpts);
      out(`Saved edge ${from} -> ${to} (${rel})`);
      break;
    }
    case "decide": {
      const [text, rationale] = rest;
      if (!text) { out("Usage: decide <text> [rationale]"); process.exitCode = 1; break; }
      core.patch({ decision: { text, rationale } }, r, patchOpts);
      out("Recorded decision.");
      break;
    }
    case "convention": {
      const text = rest.join(" ");
      if (!text) { out("Usage: convention <text>"); process.exitCode = 1; break; }
      core.patch({ convention: text }, r, patchOpts);
      out("Recorded convention.");
      break;
    }
    case "handoff": {
      if (opts.clear) {
        core.clearHandoff(r);
        out("Handoff cleared.");
        break;
      }
      const note = rest.join(" ");
      if (!note) {
        const h = core.getHandoff(r);
        out(h ? `Handoff (${h.date}): ${h.text}` : "No handoff note set.");
        break;
      }
      core.setHandoff(note, r);
      out("Handoff saved — it will lead the next digest.");
      break;
    }
    case "stats":
      out(core.stats(r));
      break;
    case "savings": {
      const { price, label } = resolvePrice(core.loadConfig(r).savings);
      const s = savingsSummary(r, { pricePerMTok: price, priceLabel: label });
      const fmt = (n) => n >= 10000 ? `${(n / 1000).toFixed(1)}k` : String(n);
      out(`projectmind savings (estimated — local ledger, never leaves this machine)`);
      out(``);
      out(`  Total saved:   ~${fmt(s.totals.tokensSavedEst)} tokens across ${s.totals.reads} map read(s)`);
      if (s.dollarsSavedEst != null) out(`  ≈ $${s.dollarsSavedEst} at ${s.priceLabel}`);
      out(`  Today:         ~${fmt(s.today.tokensSavedEst)} tokens (${s.today.reads} read(s))`);
      if (s.last7.length) {
        out(``);
        out(`  Last ${s.last7.length} day(s):`);
        const max = Math.max(...s.last7.map((d) => d.tokensSavedEst), 1);
        for (const d of s.last7) {
          const bar = "█".repeat(Math.max(1, Math.round((d.tokensSavedEst / max) * 24)));
          out(`    ${d.date}  ${bar} ~${fmt(d.tokensSavedEst)}`);
        }
      }
      const tools = Object.entries(s.byTool);
      if (tools.length) {
        out(``);
        out(`  By tool:`);
        for (const [t, v] of tools) out(`    ${t.padEnd(14)} ${String(v.reads).padStart(4)} reads   ~${fmt(v.tokensSavedEst)} saved`);
      }
      if (!s.totals.reads) out(`  No reads recorded yet — savings accrue as your agent uses the MCP tools.`);
      out(``);
      out(`  Methodology: ${s.methodology}.`);
      break;
    }
    case "validate": {
      const map = core.load(r);
      const v = core.validate(map);
      if (v.valid) {
        out("Map is valid.");
        const warns = core.summaryWarnings(map);
        const d = core.drift(r);
        for (const x of d.dangling) warns.push(`node ${x.id}: files glob matches nothing on disk (${x.files.join(", ")})`);
        if (warns.length) { out("Warnings:"); for (const w of warns) out("  - " + w); out("(run `projectmind doctor` for full drift detail)"); }
      } else {
        out("Map is INVALID:");
        for (const e of v.errors) out("  - " + e);
        process.exitCode = 1;
      }
      break;
    }
    case "install-hook": {
      try {
        const res = installHook(r);
        out(res.alreadyInstalled ? `Hook already installed at ${res.path}` : `Installed post-commit hook at ${res.path}`);
      } catch (err) {
        out("Could not install hook: " + err.message);
        process.exitCode = 1;
      }
      break;
    }
    default:
      out(`Unknown command: ${cmd}\n`);
      out(HELP);
      process.exitCode = 1;
  }
}

function warnLongSummaries(r) {
  const warns = core.summaryWarnings(core.load(r));
  for (const w of warns) process.stderr.write("[projectmind] warning: " + w + "\n");
}

main();
