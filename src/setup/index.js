// Multi-agent wiring. Writes the MCP server config and a workflow rules block
// for each supported agent, idempotently. JSON configs are MERGED (never
// clobbered); if an existing config is unparseable we back it up and skip it
// rather than destroy it. Rules files get a marked, idempotent block.
//
// Two scopes:
//  - project (default): writes .mcp.json etc. in the current repo only.
//  - global: registers projectmind once, for every future project — the same
//    "install once, works everywhere" model as codegraph's user-scoped MCP
//    entry. No rules-file text is global (CLAUDE.md/AGENTS.md are inherently
//    per-repo), only the MCP server registration.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { committedDigest, embedDigestBlock, RULES_MARKER_BEGIN, RULES_MARKER_END } from "../core/index.js";

// `mcp` is a subcommand of the main bin, so plain npx works (same invocation
// the official MCP Registry entry uses).
const MCP_ENTRY = { command: "npx", args: ["-y", "@nodemint/projectmind", "mcp"] };

const RULES_BODY = [
  RULES_MARKER_BEGIN,
  "## projectmind",
  "The current project map is embedded below (auto-synced on every change — do not hand-edit between the digest markers). Use it instead of ls/find/glob/grep when you need to explain, describe, or orient in this project.",
  "Use `mind_context({ files })` for a task-scoped subgraph, or `mind_query(<id>)` for one module's files/notes.",
  "After a structural change, architectural decision, or newly learned convention, call `mind_update` (only the fields that changed).",
  "Before the session ends (or when context is about to be compacted), call `mind_handoff` with a one-line note on what's in progress and what's next — it leads the next session's digest.",
  RULES_MARKER_END,
].join("\n");

// Each agent: a JSON MCP config location and/or a rules file to append to.
// Paths are project-relative. `key` is where the server map lives in the JSON.
const AGENTS = {
  claude: {
    label: "Claude Code",
    json: { file: ".mcp.json", key: "mcpServers" },
    rules: "CLAUDE.md",
  },
  cursor: {
    label: "Cursor",
    json: { file: ".cursor/mcp.json", key: "mcpServers" },
    rules: ".cursorrules",
  },
  windsurf: {
    label: "Windsurf",
    json: { file: ".windsurf/mcp.json", key: "mcpServers" },
    rules: ".windsurfrules",
  },
  gemini: {
    label: "Gemini CLI",
    json: { file: ".gemini/settings.json", key: "mcpServers" },
    rules: "GEMINI.md",
  },
  codex: {
    label: "Codex / generic",
    rules: "AGENTS.md",
  },
  copilot: {
    label: "GitHub Copilot",
    rules: ".github/copilot-instructions.md",
  },
};

export const SUPPORTED_AGENTS = Object.keys(AGENTS);

// file: absolute path. label: what to report back (may differ from `file`,
// e.g. "~/.cursor/mcp.json" for readability).
function mergeJsonConfig(file, key, label = file) {
  let data = {};
  if (fs.existsSync(file)) {
    try {
      data = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      const backup = `${file}.bak-${Date.now()}`;
      try { fs.copyFileSync(file, backup); } catch { /* ignore */ }
      return { file: label, status: "skipped-unparseable", backup };
    }
  }
  data[key] = data[key] || {};
  if (data[key].projectmind) return { file: label, status: "already" };
  data[key].projectmind = { ...MCP_ENTRY };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
  return { file: label, status: "written" };
}

// Appends the static instructions block if missing, then (re)embeds the
// current digest between digest markers regardless — so the very first
// setup run already carries real content, not just an instruction to fetch
// it, and every later setup run refreshes a possibly-stale embedded digest.
function appendRulesBlock(r, relFile, digestText) {
  const file = path.join(r, relFile);
  let original = "";
  try { original = fs.readFileSync(file, "utf8"); } catch { /* none */ }
  const already = original.includes(RULES_MARKER_BEGIN);
  let content = original;
  if (!already) {
    const sep = original && !original.endsWith("\n") ? "\n\n" : original ? "\n" : "";
    content = `${original}${sep}${RULES_BODY}\n`;
  }
  const updated = embedDigestBlock(content, digestText);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, updated);
  return { file: relFile, status: already ? "already" : (original ? "appended" : "created") };
}

// agents: array of agent keys, or "all". Returns a per-file result list.
export function setupAgents(r, agents = "all") {
  const keys = agents === "all" || !agents ? SUPPORTED_AGENTS : [].concat(agents).filter((k) => AGENTS[k]);
  const digestText = committedDigest(r);
  const results = [];
  for (const key of keys) {
    const a = AGENTS[key];
    if (!a) continue;
    if (a.json) results.push({ agent: key, label: a.label, ...mergeJsonConfig(path.join(r, a.json.file), a.json.key, a.json.file) });
    if (a.rules) results.push({ agent: key, label: a.label, ...appendRulesBlock(r, a.rules, digestText) });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Agent auto-detection — which agents does this machine actually have?
// Used by one-command `init` so a Claude-only user doesn't get six rules
// files of clutter. Detection is filesystem-only (config dirs each agent
// creates on first run), deterministic, and overridable for tests.
// "codex" (AGENTS.md) is always included: it's the emerging cross-agent
// standard and costs one small file.
// ---------------------------------------------------------------------------
export function detectInstalledAgents({ homeDir = os.homedir() } = {}) {
  const has = (...segs) => fs.existsSync(path.join(homeDir, ...segs));
  const found = ["codex"];
  if (has(".claude.json") || has(".claude")) found.push("claude");
  if (has(".cursor")) found.push("cursor");
  if (has(".codeium", "windsurf")) found.push("windsurf");
  if (has(".gemini")) found.push("gemini");
  return found;
}

// ---------------------------------------------------------------------------
// Global (user) scope — register once, available in every future project
// without a per-project .mcp.json. Only the MCP server entry is global; rules
// files (CLAUDE.md, AGENTS.md, ...) are inherently per-repo and untouched.
// ---------------------------------------------------------------------------
export const SUPPORTED_GLOBAL_AGENTS = ["claude", "cursor", "windsurf", "gemini"];

function globalJsonPath(agent, homeDir) {
  switch (agent) {
    case "cursor": return path.join(homeDir, ".cursor", "mcp.json");
    case "windsurf": return path.join(homeDir, ".codeium", "windsurf", "mcp_config.json");
    case "gemini": return path.join(homeDir, ".gemini", "settings.json");
    default: return null;
  }
}

// Claude Code has no documented global config file to hand-edit safely, but
// ships a first-class CLI verb for exactly this (`claude mcp add --scope
// user`) — shell out to it rather than guess an internal file format.
function addClaudeUserScope(execFile = execFileSync) {
  const label = "claude mcp (user scope)";
  try {
    execFile("claude", ["mcp", "add", "projectmind", "--scope", "user", "--", "npx", "-y", "@nodemint/projectmind", "mcp"], { stdio: "pipe" });
    return { file: label, status: "written" };
  } catch (err) {
    const msg = String(err?.stderr || err?.message || "");
    if (/already exists/i.test(msg)) return { file: label, status: "already" };
    return { file: label, status: "failed", error: (msg.split("\n").find(Boolean) || "is the `claude` CLI installed and on PATH?").trim() };
  }
}

// homeDir is overridable for tests; defaults to the real home directory.
export function setupGlobalAgents(agents = "all", { homeDir = os.homedir(), execFile = execFileSync } = {}) {
  const keys = agents === "all" || !agents ? SUPPORTED_GLOBAL_AGENTS : [].concat(agents).filter((k) => SUPPORTED_GLOBAL_AGENTS.includes(k));
  const results = [];
  for (const key of keys) {
    if (key === "claude") {
      results.push({ agent: "claude", label: "Claude Code", ...addClaudeUserScope(execFile) });
      continue;
    }
    const file = globalJsonPath(key, homeDir);
    if (!file) continue;
    const label = key === "cursor" ? "~/.cursor/mcp.json" : key === "windsurf" ? "~/.codeium/windsurf/mcp_config.json" : "~/.gemini/settings.json";
    results.push({ agent: key, label: AGENTS[key]?.label || key, ...mergeJsonConfig(file, "mcpServers", label) });
  }
  return results;
}
