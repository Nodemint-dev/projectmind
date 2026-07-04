// projectmind core — the only module that touches map.json.
// Pure-ish: every function takes an optional `root`. No network, no LLM.
import fs from "node:fs";
import path from "node:path";
import picomatch from "picomatch";

export const DIR = ".projectmind";
export const MAP = "map.json";
export const DIGEST = "digest.md";
export const LOCAL = "map.local.json";
export const CONFIG = "config.json";

export const NODE_TYPES = ["module", "component", "service", "doc", "concept"];
export const NODE_STATUSES = ["active", "stable", "deprecated"];

const DEFAULT_CONFIG = {
  digest: {
    maxNodes: 60,
    includeStatuses: ["active", "stable"],
    recentDecisions: 8,
  },
  scope: "repo",
  savings: {
    // Dollar conversion works with zero config: defaults to sonnet-tier input
    // pricing from the built-in table (see core/ledger.js). Optionally set
    // model: "haiku"|"sonnet"|"opus"|"fable", or an exact inputPricePerMTok.
    model: "sonnet",
  },
};

const emptyMap = () => ({
  version: 1,
  project: { name: "", description: "", stack: [] },
  nodes: {},
  edges: [],
  decisions: [],
  conventions: [],
  glossary: {},
});

const today = () => new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Paths & root discovery
// ---------------------------------------------------------------------------
export function root(cwd = process.cwd()) {
  let d = path.resolve(cwd);
  while (d !== path.dirname(d)) {
    if (fs.existsSync(path.join(d, DIR)) || fs.existsSync(path.join(d, ".git"))) return d;
    d = path.dirname(d);
  }
  return path.resolve(cwd);
}

const dirPath = (r) => path.join(r, DIR);
const mapPath = (r) => path.join(r, DIR, MAP);
const localPath = (r) => path.join(r, DIR, LOCAL);
const digestPath = (r) => path.join(r, DIR, DIGEST);
const configPath = (r) => path.join(r, DIR, CONFIG);

// ---------------------------------------------------------------------------
// Deterministic serialization — sort object keys, preserve array order.
// Keeps git diffs clean and round-trips stable.
// ---------------------------------------------------------------------------
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = sortKeys(value[k]);
    return out;
  }
  return value;
}

export function serialize(map) {
  return JSON.stringify(sortKeys(map), null, 2) + "\n";
}

// ---------------------------------------------------------------------------
// Atomic write: write temp, fsync, rename over target. Safe against racing
// writers (agent + git hook) — a reader never sees a half-written file.
// ---------------------------------------------------------------------------
function atomicWrite(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
export function loadConfig(r = root()) {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath(r), "utf8"));
    return {
      ...DEFAULT_CONFIG,
      ...raw,
      digest: { ...DEFAULT_CONFIG.digest, ...(raw.digest || {}) },
      savings: { ...DEFAULT_CONFIG.savings, ...(raw.savings || {}) },
    };
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
}

// ---------------------------------------------------------------------------
// Validation — never write an invalid map.
// ---------------------------------------------------------------------------
export function validate(map, { allowDanglingEdges = false } = {}) {
  const errors = [];
  const isStr = (x) => typeof x === "string";

  if (!map || typeof map !== "object") {
    return { valid: false, errors: ["map must be an object"] };
  }
  if (map.version !== 1) errors.push("version must be 1");

  if (!map.project || typeof map.project !== "object") {
    errors.push("project must be an object");
  } else {
    if (!isStr(map.project.name)) errors.push("project.name must be a string");
    if (map.project.stack != null && !Array.isArray(map.project.stack)) {
      errors.push("project.stack must be an array");
    } else if (Array.isArray(map.project.stack) && !map.project.stack.every(isStr)) {
      errors.push("project.stack must be an array of strings");
    }
    if (map.project.description != null && !isStr(map.project.description)) {
      errors.push("project.description must be a string");
    }
  }

  if (!map.nodes || typeof map.nodes !== "object" || Array.isArray(map.nodes)) {
    errors.push("nodes must be an object");
  } else {
    for (const [id, n] of Object.entries(map.nodes)) {
      if (!n || typeof n !== "object") { errors.push(`node ${id} must be an object`); continue; }
      if (!isStr(n.summary)) errors.push(`node ${id}: summary must be a string`);
      if (n.type != null && !NODE_TYPES.includes(n.type)) {
        errors.push(`node ${id}: type must be one of ${NODE_TYPES.join(", ")}`);
      }
      if (n.status != null && !NODE_STATUSES.includes(n.status)) {
        errors.push(`node ${id}: status must be one of ${NODE_STATUSES.join(", ")}`);
      }
      if (n.files != null && (!Array.isArray(n.files) || !n.files.every(isStr))) {
        errors.push(`node ${id}: files must be an array of strings`);
      }
      if (n.notes != null && !isStr(n.notes)) errors.push(`node ${id}: notes must be a string`);
    }
  }

  if (!Array.isArray(map.edges)) {
    errors.push("edges must be an array");
  } else {
    for (const e of map.edges) {
      if (!e || !isStr(e.from) || !isStr(e.to) || !isStr(e.rel)) {
        errors.push(`edge must have string from/to/rel: ${JSON.stringify(e)}`);
        continue;
      }
      if (!allowDanglingEdges && map.nodes && typeof map.nodes === "object") {
        if (!map.nodes[e.from] || !map.nodes[e.to]) {
          errors.push(`edge references unknown node: ${e.from} -> ${e.to}`);
        }
      }
    }
  }

  if (!Array.isArray(map.decisions)) {
    errors.push("decisions must be an array");
  } else {
    for (const d of map.decisions) {
      if (!d || !isStr(d.text)) errors.push(`decision must have string text: ${JSON.stringify(d)}`);
    }
  }

  if (map.conventions != null && (!Array.isArray(map.conventions) || !map.conventions.every(isStr))) {
    errors.push("conventions must be an array of strings");
  }
  if (map.glossary != null && (typeof map.glossary !== "object" || Array.isArray(map.glossary))) {
    errors.push("glossary must be an object");
  }
  if (map.handoff != null) {
    if (typeof map.handoff !== "object" || !isStr(map.handoff.text)) {
      errors.push("handoff must be an object with string text");
    }
  }

  return { valid: errors.length === 0, errors };
}

// Fill in any missing top-level fields so older/partial maps normalize cleanly.
function normalize(map) {
  const base = emptyMap();
  return {
    ...base,
    ...map,
    project: { ...base.project, ...(map.project || {}) },
    nodes: map.nodes || {},
    edges: map.edges || [],
    decisions: map.decisions || [],
    conventions: map.conventions || [],
    glossary: map.glossary || {},
  };
}

// ---------------------------------------------------------------------------
// Load — with corruption self-heal. Reads a single scope file.
// ---------------------------------------------------------------------------
function loadFile(file, { allowDanglingEdges = false } = {}) {
  if (!fs.existsSync(file)) return { map: null, existed: false };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    const map = normalize(parsed);
    const v = validate(map, { allowDanglingEdges });
    if (!v.valid) throw new Error("schema: " + v.errors.join("; "));
    return { map, existed: true };
  } catch (err) {
    try {
      fs.copyFileSync(file, `${file}.corrupt-${Date.now()}`);
    } catch { /* best effort */ }
    process.stderr.write(
      `[projectmind] ${path.basename(file)} unreadable (${err.message}); using empty map. Backup written.\n`
    );
    return { map: null, existed: false };
  }
}

// Read a single scope's raw map (for writing back to that scope).
export function loadScope(scope = "repo", r = root()) {
  const file = scope === "local" ? localPath(r) : mapPath(r);
  const { map } = loadFile(file, { allowDanglingEdges: scope === "local" });
  if (map) return map;
  const m = emptyMap();
  if (scope === "repo") m.project.name = path.basename(r);
  return m;
}

// Public load — the MERGED read view (repo + local overlay).
export function load(r = root()) {
  const repo = loadFile(mapPath(r)).map;
  const local = loadFile(localPath(r), { allowDanglingEdges: true }).map;
  const base = repo || (() => { const m = emptyMap(); m.project.name = path.basename(r); return m; })();
  if (!local) return base;
  return mergeMaps(base, local);
}

// Merge semantics: shallow node merge (local overrides), concat decisions,
// dedup conventions/edges, set-union stack, glossary merge, project override.
export function mergeMaps(base, over) {
  const m = structuredClone(base);
  if (over.project) {
    if (over.project.name) m.project.name = over.project.name;
    if (over.project.description) m.project.description = over.project.description;
  }
  m.project.stack = [...new Set([...(base.project.stack || []), ...(over.project?.stack || [])])];
  m.nodes = { ...base.nodes, ...over.nodes };
  m.edges = dedupEdges([...base.edges, ...over.edges]);
  m.decisions = [...base.decisions, ...over.decisions];
  m.conventions = [...new Set([...base.conventions, ...over.conventions])];
  m.glossary = { ...base.glossary, ...over.glossary };
  if (over.handoff) m.handoff = over.handoff;
  return m;
}

function dedupEdges(edges) {
  const seen = new Set();
  const out = [];
  for (const e of edges) {
    const k = `${e.from} ${e.to} ${e.rel}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Save — validate, atomic-write scope file, regenerate digest.md (repo only).
// ---------------------------------------------------------------------------
export function save(map, r = root(), scope = "repo") {
  const m = normalize(map);
  const allowDanglingEdges = scope === "local";
  const v = validate(m, { allowDanglingEdges });
  if (!v.valid) throw new Error("invalid map: " + v.errors.join("; "));

  fs.mkdirSync(dirPath(r), { recursive: true });
  if (scope === "local") {
    atomicWrite(localPath(r), serialize(m));
  } else {
    atomicWrite(mapPath(r), serialize(m));
    const digestText = buildDigest(m, loadConfig(r).digest);
    // digest.md reflects the committed (repo) map so PR diffs stay clean.
    atomicWrite(digestPath(r), digestText);
    // Keep every already-set-up agent's rules file (CLAUDE.md, etc.) carrying
    // the current digest inline. This is the universal, cross-agent fix for
    // "the model didn't choose to call mind_digest": rules files are loaded
    // into context by every agent unconditionally, with zero model choice
    // involved, so embedding the actual content there (not just an
    // instruction to fetch it) guarantees fresh orientation context without
    // depending on the model deciding to call a tool.
    syncRuleDigests(r, digestText);
  }
  return m;
}

// ---------------------------------------------------------------------------
// Rules-file digest embedding. Only files that already opted in via
// `projectmind setup` (i.e. already contain RULES_MARKER_BEGIN) are ever
// touched — this never spontaneously creates a rules file for an agent the
// user hasn't set up, and never embeds anything before the user has run
// setup once.
// ---------------------------------------------------------------------------
export const RULES_MARKER_BEGIN = "<!-- projectmind:begin -->";
export const RULES_MARKER_END = "<!-- projectmind:end -->";
export const DIGEST_BLOCK_BEGIN = "<!-- projectmind:digest:begin -->";
export const DIGEST_BLOCK_END = "<!-- projectmind:digest:end -->";
export const RULES_FILES = [
  "CLAUDE.md", ".cursorrules", ".windsurfrules", "GEMINI.md", "AGENTS.md",
  path.join(".github", "copilot-instructions.md"),
];

// Pure: given a rules file's current content and the digest text to embed,
// return the updated content. No-op if the static instructions block isn't
// present (agent never set up) or malformed (defensive; should not happen).
export function embedDigestBlock(content, digestText) {
  if (!content.includes(RULES_MARKER_BEGIN)) return content;
  const block = `${DIGEST_BLOCK_BEGIN}\n${digestText.trim()}\n${DIGEST_BLOCK_END}`;
  if (content.includes(DIGEST_BLOCK_BEGIN) && content.includes(DIGEST_BLOCK_END)) {
    const start = content.indexOf(DIGEST_BLOCK_BEGIN);
    const end = content.indexOf(DIGEST_BLOCK_END) + DIGEST_BLOCK_END.length;
    return content.slice(0, start) + block + content.slice(end);
  }
  const markerEndIdx = content.indexOf(RULES_MARKER_END);
  if (markerEndIdx === -1) return content;
  const insertAt = markerEndIdx + RULES_MARKER_END.length;
  return content.slice(0, insertAt) + `\n\n${block}` + content.slice(insertAt);
}

// The digest text safe to embed in COMMITTED rules files — repo scope only,
// never merged with the local overlay (which may carry personal handoff
// notes). Same content as digest.md.
export function committedDigest(r = root()) {
  return buildDigest(loadScope("repo", r), loadConfig(r).digest);
}

function syncRuleDigests(r, digestText) {
  for (const relFile of RULES_FILES) {
    const file = path.join(r, relFile);
    let content;
    try { content = fs.readFileSync(file, "utf8"); } catch { continue; }
    const updated = embedDigestBlock(content, digestText);
    if (updated !== content) {
      try { fs.writeFileSync(file, updated); } catch { /* best effort */ }
    }
  }
}

// Which rules files currently carry an embedded digest — i.e. every agent
// session there sees the map for free, with no tool call and therefore
// nothing recorded in the savings ledger. Informational only: deliberately
// NOT converted into a token/dollar estimate, since there's no way to
// observe how many times an agent actually reads a static context file.
export function embeddedDigestFiles(r = root()) {
  const found = [];
  for (const relFile of RULES_FILES) {
    let content;
    try { content = fs.readFileSync(path.join(r, relFile), "utf8"); } catch { continue; }
    if (content.includes(DIGEST_BLOCK_BEGIN) && content.includes(DIGEST_BLOCK_END)) found.push(relFile);
  }
  return found;
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
export function init(r = root(), { gitignoreLocal = true } = {}) {
  fs.mkdirSync(dirPath(r), { recursive: true });
  if (!fs.existsSync(configPath(r))) {
    atomicWrite(configPath(r), JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n");
  }
  let map;
  if (fs.existsSync(mapPath(r))) {
    map = loadScope("repo", r);
  } else {
    const m = emptyMap();
    m.project.name = path.basename(r);
    map = save(m, r);
  }
  if (gitignoreLocal) ensureLocalGitignored(r);
  return map;
}

export function ensureLocalGitignored(r = root()) {
  const gi = path.join(r, ".gitignore");
  // Per-developer files: the local overlay and the savings ledger. Both are
  // private to the machine and must never be committed.
  const lines = [`${DIR}/${LOCAL}`, `${DIR}/ledger.json`];
  let content = "";
  try { content = fs.readFileSync(gi, "utf8"); } catch { /* none yet */ }
  const present = new Set(content.split(/\r?\n/).map((l) => l.trim()));
  const missing = lines.filter((l) => !present.has(l));
  if (!missing.length) return false;
  const prefix = content && !content.endsWith("\n") ? "\n" : "";
  fs.appendFileSync(gi, `${prefix}${missing.join("\n")}\n`);
  return true;
}

// ---------------------------------------------------------------------------
// Patch — load a scope, apply a delta, save it back. The write contract.
// ---------------------------------------------------------------------------
export function patch(delta = {}, r = root(), opts = {}) {
  const scope = opts.scope || loadConfig(r).scope || "repo";
  const m = loadScope(scope, r);

  if (delta.project) Object.assign(m.project, delta.project);
  if (delta.stack) m.project.stack = [...new Set([...(m.project.stack || []), ...delta.stack])];

  if (delta.node) {
    const { id, ...fields } = delta.node;
    if (!id) throw new Error("node delta requires an id");
    m.nodes[id] = {
      type: "module",
      status: "active",
      ...(m.nodes[id] || {}),
      ...fields,
      lastTouched: today(),
    };
  }
  if (delta.removeNode) {
    delete m.nodes[delta.removeNode];
    m.edges = m.edges.filter((e) => e.from !== delta.removeNode && e.to !== delta.removeNode);
  }
  if (delta.edge) {
    const e = delta.edge;
    if (!m.edges.some((x) => x.from === e.from && x.to === e.to && x.rel === e.rel)) m.edges.push(e);
  }
  if (delta.removeEdge) {
    const e = delta.removeEdge;
    m.edges = m.edges.filter((x) => !(x.from === e.from && x.to === e.to && x.rel === e.rel));
  }
  if (delta.decision) {
    const d = delta.decision;
    const maxN = m.decisions.reduce((mx, x) => {
      const n = parseInt(String(x.id || "").replace(/^d/, ""), 10);
      return Number.isFinite(n) && n > mx ? n : mx;
    }, 0);
    m.decisions.push({
      id: "d" + (maxN + 1),
      text: typeof d === "string" ? d : d.text,
      ...(d.rationale ? { rationale: d.rationale } : {}),
      date: today(),
    });
  }
  if (delta.convention && !m.conventions.includes(delta.convention)) m.conventions.push(delta.convention);
  if (delta.glossary) m.glossary = { ...m.glossary, ...delta.glossary };
  if (delta.handoff) {
    const text = typeof delta.handoff === "string" ? delta.handoff : delta.handoff.text;
    m.handoff = { text, date: today() };
  }
  if (delta.clearHandoff) delete m.handoff;

  return save(m, r, scope);
}

// ---------------------------------------------------------------------------
// Session handoff — "what I was doing, what's next", carried across sessions.
// Lives in the LOCAL overlay by design: it's per-developer working state, not
// shared architecture. Surfaces at the top of the next session's digest.
// ---------------------------------------------------------------------------
export function setHandoff(text, r = root()) {
  return patch({ handoff: text }, r, { scope: "local" });
}

export function clearHandoff(r = root()) {
  return patch({ clearHandoff: true }, r, { scope: "local" });
}

export function getHandoff(r = root()) {
  return load(r).handoff || null;
}

// ---------------------------------------------------------------------------
// Query & search — read the merged view.
// ---------------------------------------------------------------------------
export function query(id, r = root()) {
  const m = load(r);
  const n = m.nodes[id];
  if (!n) return null;
  const result = {
    id,
    ...n,
    dependsOn: m.edges.filter((e) => e.from === id),
    dependedBy: m.edges.filter((e) => e.to === id),
  };
  if (hasCodegraph(r)) {
    result.codegraph = `For symbol-level detail on this module, use codegraph: \`codegraph explore "${id}"\` or the codegraph_explore MCP tool.`;
  }
  return result;
}

export function search(term, r = root()) {
  const m = load(r);
  const t = String(term || "").toLowerCase();
  if (!t) return [];
  const hits = [];
  for (const [id, n] of Object.entries(m.nodes)) {
    if (
      id.toLowerCase().includes(t) ||
      (n.summary || "").toLowerCase().includes(t) ||
      (n.notes || "").toLowerCase().includes(t)
    ) {
      hits.push({ kind: "node", id, summary: n.summary, status: n.status });
    }
  }
  for (const d of m.decisions) {
    if ((d.text || "").toLowerCase().includes(t) || (d.rationale || "").toLowerCase().includes(t)) {
      hits.push({ kind: "decision", id: d.id, text: d.text, date: d.date });
    }
  }
  for (const [term2, def] of Object.entries(m.glossary || {})) {
    if (term2.toLowerCase().includes(t) || String(def).toLowerCase().includes(t)) {
      hits.push({ kind: "glossary", term: term2, definition: def });
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Token estimation — honest heuristic, ~4 chars/token.
// ---------------------------------------------------------------------------
export const estimateTokens = (s) => Math.ceil((s || "").length / 4);

// ---------------------------------------------------------------------------
// Digest — the compact map an agent reads first.
// ---------------------------------------------------------------------------
export function buildDigest(map, cfg = DEFAULT_CONFIG.digest) {
  const m = normalize(map);
  const conf = { ...DEFAULT_CONFIG.digest, ...(cfg || {}) };
  const include = new Set(conf.includeStatuses);
  const L = [];

  L.push(`# ${m.project.name || "project"} — project map`);
  if (m.project.description) L.push(m.project.description);
  if (m.project.stack?.length) L.push(`Stack: ${m.project.stack.join(", ")}`);
  L.push("");

  // Session handoff goes first — it's the "resume where you left off" note.
  if (m.handoff?.text) {
    L.push(`## ⏪ Handoff from last session${m.handoff.date ? ` (${m.handoff.date})` : ""}`);
    L.push(m.handoff.text);
    L.push("> When this is done or stale, call mind_handoff with clear: true (or leave a new note).");
    L.push("");
  }

  const entries = Object.entries(m.nodes).sort(([a], [b]) => a.localeCompare(b));
  const included = entries.filter(([, n]) => include.has(n.status || "active"));
  const active = included.filter(([, n]) => (n.status || "active") === "active");
  const stable = included.filter(([, n]) => n.status === "stable");
  const other = included.filter(([, n]) => (n.status || "active") !== "active" && n.status !== "stable");

  const line = (id, n, tag) => `- **${id}**${n.summary ? `: ${n.summary}` : ""}${tag ? ` [${tag}]` : ""}`;

  if (included.length > conf.maxNodes) {
    // Large project: list active fully, summarize the rest by type so the
    // digest stays roughly constant-size.
    if (active.length) L.push("## Active", ...active.map(([id, n]) => line(id, n, "active")), "");
    const rest = [...stable, ...other];
    if (rest.length) {
      const byType = {};
      for (const [, n] of rest) {
        const t = n.type || "module";
        byType[t] = (byType[t] || 0) + 1;
      }
      const summary = Object.entries(byType)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([t, c]) => `${c} ${t}${c === 1 ? "" : "s"}`)
        .join(", ");
      L.push("## Modules (summarized)", `- ${rest.length} more nodes: ${summary}`, "> Use mind_search or mind_query to drill into specific modules.", "");
    }
  } else {
    if (active.length) L.push("## Active", ...active.map(([id, n]) => line(id, n, "active")), "");
    if (stable.length) L.push("## Modules", ...stable.map(([id, n]) => line(id, n)), "");
    if (other.length) L.push("## Other", ...other.map(([id, n]) => line(id, n, n.status)), "");
  }

  const edges = m.edges.filter((e) => m.nodes[e.from] && m.nodes[e.to] && include.has(m.nodes[e.from].status || "active") && include.has(m.nodes[e.to].status || "active"));
  if (edges.length) {
    L.push("## Dependencies");
    for (const e of edges) L.push(`- ${e.from} → ${e.to} (${e.rel})`);
    L.push("");
  }

  if (m.decisions.length) {
    L.push("## Key decisions");
    for (const d of m.decisions.slice(-conf.recentDecisions)) L.push(`- ${d.text}${d.date ? ` (${d.date})` : ""}`);
    L.push("");
  }

  if (m.conventions.length) L.push("## Conventions", ...m.conventions.map((c) => `- ${c}`), "");

  const glossary = Object.entries(m.glossary || {}).sort(([a], [b]) => a.localeCompare(b));
  if (glossary.length) L.push("## Glossary", ...glossary.map(([t, d]) => `- ${t}: ${d}`), "");

  L.push("> Use mind_query(<id>) for file lists and detail; call mind_update after structural changes.");
  return L.join("\n") + "\n";
}

export function digest(r = root()) {
  let out = buildDigest(load(r), loadConfig(r).digest);
  if (hasCodegraph(r)) out += CODEGRAPH_HINT + "\n";
  return out;
}

// ---------------------------------------------------------------------------
// Stats — for benchmark & trust.
// ---------------------------------------------------------------------------
export function stats(r = root()) {
  const m = load(r);
  const d = buildDigest(m, loadConfig(r).digest);
  return {
    nodes: Object.keys(m.nodes).length,
    edges: m.edges.length,
    decisions: m.decisions.length,
    conventions: m.conventions.length,
    glossaryTerms: Object.keys(m.glossary || {}).length,
    digestChars: d.length,
    digestTokensEst: estimateTokens(d),
    embeddedDigestIn: embeddedDigestFiles(r),
  };
}

// ---------------------------------------------------------------------------
// Soft summary-length check — surfaced as warnings, never blocks a save.
// ---------------------------------------------------------------------------
export const SUMMARY_SOFT_CAP = 140;
export function summaryWarnings(map) {
  const warnings = [];
  for (const [id, n] of Object.entries(normalize(map).nodes)) {
    if ((n.summary || "").length > SUMMARY_SOFT_CAP) {
      warnings.push(`node ${id}: summary is ${n.summary.length} chars (> ${SUMMARY_SOFT_CAP} soft cap)`);
    }
  }
  return warnings;
}

// ---------------------------------------------------------------------------
// codegraph awareness — projectmind is the "why" (intent, decisions); if a
// codegraph index exists it owns the "how" (symbols, call paths). We point at
// it rather than duplicate it. Detection only; zero dependency on codegraph.
// ---------------------------------------------------------------------------
export function hasCodegraph(r = root()) {
  return fs.existsSync(path.join(r, ".codegraph"));
}

const CODEGRAPH_HINT =
  "> Structural detail (symbols, call paths) is available via codegraph — run `codegraph explore \"<symbol>\"` or the codegraph_explore MCP tool.";

// ---------------------------------------------------------------------------
// Repo file walker — used by seed, drift, and watch. Skips the usual noise.
// ---------------------------------------------------------------------------
const IGNORE_DIRS = new Set([
  ".git", ".projectmind", ".codegraph", "node_modules", "dist", "build",
  ".next", ".nuxt", "out", "coverage", ".venv", "venv", "__pycache__",
  ".dart_tool", "target", "vendor", ".idea", ".vscode",
]);

export function walkFiles(r = root(), { max = 20000 } = {}) {
  const files = [];
  const walk = (abs) => {
    if (files.length >= max) return;
    let entries;
    try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (files.length >= max) return;
      if (e.name.startsWith(".") && e.isDirectory() && IGNORE_DIRS.has(e.name)) continue;
      if (e.isDirectory()) {
        if (IGNORE_DIRS.has(e.name)) continue;
        walk(path.join(abs, e.name));
      } else if (e.isFile()) {
        files.push(path.relative(r, path.join(abs, e.name)).split(path.sep).join("/"));
      }
    }
  };
  walk(r);
  return files;
}

// ---------------------------------------------------------------------------
// Stack detection — deterministic, from manifest files. No language guessing.
// ---------------------------------------------------------------------------
export function detectStack(r = root()) {
  const has = (f) => fs.existsSync(path.join(r, f));
  const read = (f) => { try { return fs.readFileSync(path.join(r, f), "utf8"); } catch { return ""; } };
  const stack = new Set();

  if (has("package.json")) {
    stack.add("node");
    try {
      const pkg = JSON.parse(read("package.json"));
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      if (deps.react || deps["react-dom"]) stack.add("react");
      if (deps.next) stack.add("nextjs");
      if (deps.vue) stack.add("vue");
      if (deps.svelte) stack.add("svelte");
      if (deps.express) stack.add("express");
      if (deps["@nestjs/core"]) stack.add("nestjs");
      if (deps.typescript || has("tsconfig.json")) stack.add("typescript");
    } catch { /* ignore */ }
  }
  if (has("tsconfig.json")) stack.add("typescript");
  if (has("pubspec.yaml")) { stack.add("dart"); if (read("pubspec.yaml").includes("flutter")) stack.add("flutter"); }
  if (has("requirements.txt") || has("pyproject.toml") || has("setup.py")) stack.add("python");
  if (has("go.mod")) stack.add("go");
  if (has("Cargo.toml")) stack.add("rust");
  if (has("Gemfile")) stack.add("ruby");
  if (has("composer.json")) stack.add("php");
  if (has("pom.xml") || has("build.gradle") || has("build.gradle.kts")) stack.add("java");
  if (has("Package.swift")) stack.add("swift");

  return [...stack];
}

// ---------------------------------------------------------------------------
// Seed proposal — a deterministic starter map from repo layout. No LLM.
// Proposes a node per top-level source directory that contains code, plus
// project name/description/stack. Never overwrites existing nodes.
// ---------------------------------------------------------------------------
const CODE_EXT = /\.(js|jsx|ts|tsx|mjs|cjs|py|go|rs|rb|php|java|kt|swift|dart|c|cc|cpp|h|hpp|cs|scala|ex|exs)$/i;
const SOURCE_DIR_HINTS = new Set([
  "src", "lib", "app", "apps", "packages", "components", "pages", "api",
  "server", "services", "routes", "controllers", "models", "views", "modules", "core",
]);

export function proposeSeed(r = root()) {
  const files = walkFiles(r);
  const proposal = { project: {}, stack: detectStack(r), nodes: {} };

  // name + description
  let name = path.basename(r);
  let description = "";
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(r, "package.json"), "utf8"));
    if (pkg.name) name = pkg.name;
    if (pkg.description) description = pkg.description;
  } catch { /* ignore */ }
  if (!description) {
    try {
      const readme = fs.readFileSync(path.join(r, "README.md"), "utf8");
      const line = readme.split(/\r?\n/).map((l) => l.trim()).find((l) => l && !l.startsWith("#") && !l.startsWith("!["));
      if (line) description = line.slice(0, SUMMARY_SOFT_CAP);
    } catch { /* ignore */ }
  }
  proposal.project.name = name;
  if (description) proposal.project.description = description;

  // group code files by their top-level directory
  const byTop = {};
  for (const f of files) {
    if (!CODE_EXT.test(f)) continue;
    const top = f.split("/")[0];
    if (f.indexOf("/") === -1) continue; // skip loose top-level files
    (byTop[top] ||= []).push(f);
  }
  for (const [top, list] of Object.entries(byTop)) {
    if (!SOURCE_DIR_HINTS.has(top) && list.length < 2) continue; // ignore incidental dirs
    proposal.nodes[top] = {
      type: "module",
      summary: `${top}/ — ${list.length} source file${list.length === 1 ? "" : "s"} (describe me)`,
      files: [`${top}/**`],
      status: "stable",
    };
  }
  return proposal;
}

// Apply a seed proposal, only adding nodes/fields that don't already exist.
export function seed(r = root(), opts = {}) {
  const proposal = proposeSeed(r);
  const existing = loadScope("repo", r);
  const delta = { project: {}, stack: proposal.stack, glossary: {} };
  if (!existing.project.name || existing.project.name === path.basename(r)) delta.project.name = proposal.project.name;
  if (!existing.project.description && proposal.project.description) delta.project.description = proposal.project.description;

  const added = [];
  // seed project + stack first
  patch({ project: delta.project, stack: delta.stack }, r, { scope: "repo" });
  for (const [id, node] of Object.entries(proposal.nodes)) {
    if (existing.nodes[id]) continue; // never clobber a curated node
    patch({ node: { id, ...node } }, r, { scope: "repo" });
    added.push(id);
  }
  return { added, proposedNodes: Object.keys(proposal.nodes), stack: proposal.stack };
}

// ---------------------------------------------------------------------------
// Drift detection — trust check. Which nodes point at files that no longer
// exist, and which look stale (untouched a long time).
// ---------------------------------------------------------------------------
export function drift(r = root(), { staleDays = 90, now = new Date() } = {}) {
  const map = load(r);
  const files = walkFiles(r);
  const dangling = [];
  const stale = [];
  for (const [id, n] of Object.entries(map.nodes)) {
    const globs = n.files || [];
    if (globs.length) {
      const isMatch = picomatch(globs, { dot: true });
      if (!files.some((f) => isMatch(f))) dangling.push({ id, files: globs });
    }
    if (n.lastTouched) {
      const days = Math.floor((now - new Date(n.lastTouched)) / 86400000);
      if (Number.isFinite(days) && days > staleDays) stale.push({ id, lastTouched: n.lastTouched, days });
    }
  }
  return { dangling, stale };
}

// ---------------------------------------------------------------------------
// Task-scoped context — the "surgical" digest. Given the files you're editing
// (or a node id, or a search term), return just the relevant subgraph:
// seed nodes in full, their edge-neighbors (out to `depth`) as summaries.
// ---------------------------------------------------------------------------
export function seedNodeIds(map, { files, node, term } = {}) {
  const ids = new Set();
  if (node && map.nodes[node]) ids.add(node);
  if (files && files.length) {
    for (const [id, n] of Object.entries(map.nodes)) {
      const globs = n.files || [];
      if (!globs.length) continue;
      const isMatch = picomatch(globs, { dot: true });
      if (files.some((f) => isMatch(String(f).split(path.sep).join("/")))) ids.add(id);
    }
  }
  if (term) {
    const t = String(term).toLowerCase();
    for (const [id, n] of Object.entries(map.nodes)) {
      if (id.toLowerCase().includes(t) || (n.summary || "").toLowerCase().includes(t) || (n.notes || "").toLowerCase().includes(t)) ids.add(id);
    }
  }
  return ids;
}

export function buildContext(map, selector = {}, { depth = 1 } = {}) {
  const m = normalize(map);
  const seeds = seedNodeIds(m, selector);
  // expand neighbors up to depth
  const included = new Set(seeds);
  let frontier = new Set(seeds);
  for (let d = 0; d < depth; d++) {
    const next = new Set();
    for (const e of m.edges) {
      if (frontier.has(e.from) && !included.has(e.to)) { next.add(e.to); }
      if (frontier.has(e.to) && !included.has(e.from)) { next.add(e.from); }
    }
    for (const id of next) included.add(id);
    frontier = next;
    if (!next.size) break;
  }

  const L = [];
  if (!seeds.size) {
    L.push("No matching nodes. Fall back to mind_digest, or the map may not cover this area yet.");
    return L.join("\n") + "\n";
  }
  L.push(`# Context (${[...seeds].sort().join(", ")})`, "");
  L.push("## Focus");
  for (const id of [...seeds].sort()) {
    const n = m.nodes[id];
    L.push(`- **${id}**${n.summary ? `: ${n.summary}` : ""}${n.status ? ` [${n.status}]` : ""}`);
    if (n.files?.length) L.push(`  - files: ${n.files.join(", ")}`);
    if (n.notes) L.push(`  - notes: ${n.notes}`);
  }
  const neighbors = [...included].filter((id) => !seeds.has(id)).sort();
  if (neighbors.length) {
    L.push("", "## Related");
    for (const id of neighbors) {
      const n = m.nodes[id];
      L.push(`- **${id}**${n.summary ? `: ${n.summary}` : ""}`);
    }
  }
  const edges = m.edges.filter((e) => included.has(e.from) && included.has(e.to));
  if (edges.length) {
    L.push("", "## Dependencies");
    for (const e of edges) L.push(`- ${e.from} → ${e.to} (${e.rel})`);
  }
  return L.join("\n") + "\n";
}

export function context(selector = {}, r = root(), opts = {}) {
  let out = buildContext(load(r), selector, opts);
  if (hasCodegraph(r)) out += "\n" + CODEGRAPH_HINT + "\n";
  return out;
}
