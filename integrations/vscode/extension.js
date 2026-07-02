// projectmind savings — VS Code status bar counter.
// Reads .projectmind/ledger.json from the workspace (written locally by the
// projectmind MCP server) and shows estimated tokens saved. Zero dependencies,
// zero network: this extension only ever reads one local JSON file.
const vscode = require("vscode");
const fs = require("fs");
const path = require("path");

let statusItem = null;
let watchers = [];

function findLedger() {
  const folders = vscode.workspace.workspaceFolders || [];
  for (const f of folders) {
    const p = path.join(f.uri.fsPath, ".projectmind", "ledger.json");
    if (fs.existsSync(p)) return p;
  }
  // No ledger yet — still return the expected path of the first folder that
  // has a .projectmind dir, so we can watch for the ledger appearing.
  for (const f of folders) {
    const dir = path.join(f.uri.fsPath, ".projectmind");
    if (fs.existsSync(dir)) return path.join(dir, "ledger.json");
  }
  return null;
}

function readLedger(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function fmt(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return String(n || 0);
}

// Mirrors core/ledger.js resolvePrice: zero-config dollars at sonnet-tier
// input pricing (published rates as of 2026-06), overridable in config.json.
const MODEL_INPUT_PRICES = { haiku: 1, sonnet: 3, opus: 5, fable: 10 };

function readPrice(file) {
  let savings = {};
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(path.dirname(file), "config.json"), "utf8"));
    savings = (cfg && cfg.savings) || {};
  } catch { /* fall through to defaults */ }
  if (Number.isFinite(savings.inputPricePerMTok)) {
    return { price: savings.inputPricePerMTok, label: `$${savings.inputPricePerMTok}/MTok (configured)` };
  }
  const model = MODEL_INPUT_PRICES[savings.model] != null ? savings.model : "sonnet";
  return { price: MODEL_INPUT_PRICES[model], label: `${model}-tier input pricing` };
}

function refresh() {
  const file = findLedger();
  if (!file) {
    statusItem.hide();
    return;
  }
  const ledger = readLedger(file);
  const saved = ledger && ledger.totals ? ledger.totals.tokensSavedEst : 0;
  const reads = ledger && ledger.totals ? ledger.totals.reads : 0;
  const today = new Date().toISOString().slice(0, 10);
  const todaySaved = ledger && ledger.days && ledger.days[today] ? ledger.days[today].tokensSavedEst : 0;
  const { price, label } = readPrice(file);

  statusItem.text = `$(sparkle) ~${fmt(saved)} tokens saved`;
  const lines = [
    `projectmind — estimated savings (local ledger, never leaves this machine)`,
    ``,
    `Total: ~${fmt(saved)} tokens across ${reads} map read(s)`,
    `Today: ~${fmt(todaySaved)} tokens`,
    `≈ $${(saved / 1_000_000 * price).toFixed(2)} at ${label}`,
  ];
  lines.push(``, `Estimates use ceil(bytes/4); baseline = files the agent would have read instead.`);
  statusItem.tooltip = lines.join("\n");
  statusItem.show();
}

function watchLedger(context) {
  for (const w of watchers) { try { w.close(); } catch { /* ignore */ } }
  watchers = [];
  const folders = vscode.workspace.workspaceFolders || [];
  for (const f of folders) {
    const dir = path.join(f.uri.fsPath, ".projectmind");
    if (!fs.existsSync(dir)) continue;
    try {
      const w = fs.watch(dir, (_event, filename) => {
        if (filename === "ledger.json" || filename === "config.json") refresh();
      });
      watchers.push(w);
      context.subscriptions.push({ dispose: () => { try { w.close(); } catch { /* ignore */ } } });
    } catch { /* ignore */ }
  }
}

function activate(context) {
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusItem.command = "projectmind.showSavings";
  context.subscriptions.push(statusItem);

  context.subscriptions.push(
    vscode.commands.registerCommand("projectmind.showSavings", () => {
      const file = findLedger();
      const ledger = file && readLedger(file);
      if (!ledger || !ledger.totals || !ledger.totals.reads) {
        vscode.window.showInformationMessage(
          "projectmind: no savings recorded yet. Savings accrue as your AI agent uses the MCP tools (mind_digest, mind_context, mind_query)."
        );
        return;
      }
      const { price } = readPrice(file);
      const t = ledger.totals;
      const dollars = ` (≈ $${(t.tokensSavedEst / 1_000_000 * price).toFixed(2)})`;
      vscode.window.showInformationMessage(
        `projectmind saved you an estimated ~${fmt(t.tokensSavedEst)} tokens${dollars} across ${t.reads} map reads — instead of ~${fmt(t.tokensBaselineEst)} tokens of file scanning, your agent read ~${fmt(t.tokensServed)}.`
      );
    })
  );

  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => { watchLedger(context); refresh(); }));

  watchLedger(context);
  refresh();
  // Ledger writes are atomic renames; a light poll catches anything fs.watch misses.
  const timer = setInterval(refresh, 30_000);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });
}

function deactivate() {
  for (const w of watchers) { try { w.close(); } catch { /* ignore */ } }
}

module.exports = { activate, deactivate };
