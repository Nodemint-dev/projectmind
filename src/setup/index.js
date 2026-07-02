// Multi-agent wiring. Writes the MCP server config and a workflow rules block
// for each supported agent, idempotently. JSON configs are MERGED (never
// clobbered); if an existing config is unparseable we back it up and skip it
// rather than destroy it. Rules files get a marked, idempotent block.
import fs from "node:fs";
import path from "node:path";

// Scoped package with two bins: -p pulls @nodemint/projectmind, then the
// projectmind-mcp bin from it is executed.
const MCP_ENTRY = { command: "npx", args: ["-y", "-p", "@nodemint/projectmind", "projectmind-mcp"] };

const RULES_BEGIN = "<!-- projectmind:begin -->";
const RULES_END = "<!-- projectmind:end -->";
const RULES_BODY = [
  RULES_BEGIN,
  "## projectmind",
  "At the start of a task, call `mind_digest` before reading source files or asking about project structure.",
  "Use `mind_context({ files })` for a task-scoped subgraph, or `mind_query(<id>)` for one module's files/notes.",
  "After a structural change, architectural decision, or newly learned convention, call `mind_update` (only the fields that changed).",
  "Before the session ends (or when context is about to be compacted), call `mind_handoff` with a one-line note on what's in progress and what's next — it leads the next session's digest.",
  RULES_END,
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

function mergeJsonConfig(r, spec) {
  const file = path.join(r, spec.file);
  let data = {};
  if (fs.existsSync(file)) {
    try {
      data = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      const backup = `${file}.bak-${Date.now()}`;
      try { fs.copyFileSync(file, backup); } catch { /* ignore */ }
      return { file: spec.file, status: "skipped-unparseable", backup };
    }
  }
  data[spec.key] = data[spec.key] || {};
  if (data[spec.key].projectmind) return { file: spec.file, status: "already" };
  data[spec.key].projectmind = { ...MCP_ENTRY };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
  return { file: spec.file, status: "written" };
}

function appendRulesBlock(r, relFile) {
  const file = path.join(r, relFile);
  let content = "";
  try { content = fs.readFileSync(file, "utf8"); } catch { /* none */ }
  if (content.includes(RULES_BEGIN)) return { file: relFile, status: "already" };
  const sep = content && !content.endsWith("\n") ? "\n\n" : content ? "\n" : "";
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${content}${sep}${RULES_BODY}\n`);
  return { file: relFile, status: content ? "appended" : "created" };
}

// agents: array of agent keys, or "all". Returns a per-file result list.
export function setupAgents(r, agents = "all") {
  const keys = agents === "all" || !agents ? SUPPORTED_AGENTS : [].concat(agents).filter((k) => AGENTS[k]);
  const results = [];
  for (const key of keys) {
    const a = AGENTS[key];
    if (!a) continue;
    if (a.json) results.push({ agent: key, label: a.label, ...mergeJsonConfig(r, a.json) });
    if (a.rules) results.push({ agent: key, label: a.label, ...appendRulesBlock(r, a.rules) });
  }
  return results;
}
