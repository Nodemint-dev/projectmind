import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRoot, cleanup } from "./helpers.js";
import {
  init, patch, load, detectStack, proposeSeed, seed, drift,
  buildContext, context, hasCodegraph, digest, query,
} from "../src/core/index.js";
import { setupAgents, setupGlobalAgents } from "../src/setup/index.js";
import { reconcile } from "../src/watch/index.js";

function scaffoldRepo(r) {
  fs.mkdirSync(path.join(r, "src", "routes"), { recursive: true });
  fs.writeFileSync(path.join(r, "package.json"), JSON.stringify({ name: "demo", description: "a demo api", dependencies: { express: "^4" } }));
  fs.writeFileSync(path.join(r, "README.md"), "# demo\n\nA small demo service.\n");
  fs.writeFileSync(path.join(r, "src", "server.js"), "export const a = 1;\n");
  fs.writeFileSync(path.join(r, "src", "db.js"), "export const b = 2;\n");
  fs.writeFileSync(path.join(r, "src", "routes", "users.js"), "export const c = 3;\n");
}

test("detectStack reads manifests deterministically", () => {
  const r = tmpRoot();
  try {
    scaffoldRepo(r);
    const stack = detectStack(r);
    assert.ok(stack.includes("node"));
    assert.ok(stack.includes("express"));
  } finally { cleanup(r); }
});

test("proposeSeed builds nodes from top-level source dirs + name/description", () => {
  const r = tmpRoot();
  try {
    scaffoldRepo(r);
    const p = proposeSeed(r);
    assert.equal(p.project.name, "demo");
    assert.equal(p.project.description, "a demo api");
    assert.ok(p.nodes.src, "expected a node for src/");
    assert.deepEqual(p.nodes.src.files, ["src/**"]);
  } finally { cleanup(r); }
});

test("seed adds missing nodes but never clobbers curated ones", () => {
  const r = tmpRoot();
  try {
    scaffoldRepo(r);
    init(r);
    patch({ node: { id: "src", summary: "MY CURATED SUMMARY", status: "active" } }, r);
    const res = seed(r);
    const m = load(r);
    assert.equal(m.nodes.src.summary, "MY CURATED SUMMARY"); // preserved
    assert.ok(!res.added.includes("src"));
  } finally { cleanup(r); }
});

test("drift flags nodes whose files no longer exist", () => {
  const r = tmpRoot();
  try {
    scaffoldRepo(r);
    init(r);
    patch({ node: { id: "ghost", summary: "gone", files: ["src/does-not-exist/**"] } }, r);
    patch({ node: { id: "real", summary: "here", files: ["src/**"] } }, r);
    const d = drift(r);
    const danglingIds = d.dangling.map((x) => x.id);
    assert.ok(danglingIds.includes("ghost"));
    assert.ok(!danglingIds.includes("real"));
  } finally { cleanup(r); }
});

test("drift flags stale nodes past the threshold", () => {
  const r = tmpRoot();
  try {
    scaffoldRepo(r);
    init(r);
    patch({ node: { id: "old", summary: "old", files: ["src/**"] } }, r);
    // force an old lastTouched by editing the saved map directly then reloading
    const m = load(r); m.nodes.old.lastTouched = "2020-01-01";
    fs.writeFileSync(path.join(r, ".projectmind", "map.json"), JSON.stringify(m, null, 2));
    const d = drift(r, { staleDays: 90, now: new Date("2026-07-01") });
    assert.ok(d.stale.some((x) => x.id === "old"));
  } finally { cleanup(r); }
});

test("buildContext returns seed nodes in full + neighbors + edges", () => {
  const map = {
    version: 1, project: { name: "p", stack: [] },
    nodes: {
      a: { type: "module", summary: "A", status: "active", files: ["src/a/**"], notes: "note A" },
      b: { type: "module", summary: "B", status: "stable" },
      c: { type: "module", summary: "C", status: "stable" },
    },
    edges: [{ from: "a", to: "b", rel: "calls" }],
    decisions: [], conventions: [], glossary: {},
  };
  const out = buildContext(map, { files: ["src/a/index.js"] }, { depth: 1 });
  assert.match(out, /## Focus[\s\S]*\*\*a\*\*/);
  assert.match(out, /note A/);          // seed node shows notes
  assert.match(out, /## Related[\s\S]*\*\*b\*\*/); // neighbor pulled in
  assert.match(out, /a → b \(calls\)/);
  assert.doesNotMatch(out, /\*\*c\*\*/); // unrelated node excluded
});

test("context by node id works and reports no-match cleanly", () => {
  const r = tmpRoot();
  try {
    init(r);
    patch({ node: { id: "auth", summary: "auth", status: "active" } }, r);
    assert.match(context({ node: "auth" }, r), /auth/);
    assert.match(context({ node: "nope" }, r), /No matching nodes/);
  } finally { cleanup(r); }
});

test("hasCodegraph detects .codegraph and digest/query add a pointer", () => {
  const r = tmpRoot();
  try {
    init(r);
    patch({ node: { id: "auth", summary: "auth", status: "active" } }, r);
    assert.equal(hasCodegraph(r), false);
    assert.doesNotMatch(digest(r), /codegraph/);
    fs.mkdirSync(path.join(r, ".codegraph"), { recursive: true });
    assert.equal(hasCodegraph(r), true);
    assert.match(digest(r), /codegraph/);
    assert.match(query("auth", r).codegraph, /codegraph/);
  } finally { cleanup(r); }
});

test("reconcile bumps freshness for changed files (watch core logic)", () => {
  const r = tmpRoot();
  try {
    init(r);
    patch({ node: { id: "auth", summary: "auth", status: "stable", files: ["src/auth.js"] } }, r);
    const bumped = reconcile(r, ["src/auth.js"]);
    assert.deepEqual(bumped, ["auth"]);
    assert.equal(load(r).nodes.auth.status, "active");
  } finally { cleanup(r); }
});

test("setupAgents writes MCP config + rules idempotently, merging existing JSON", () => {
  const r = tmpRoot();
  try {
    // pre-existing .mcp.json with another server must be preserved
    fs.writeFileSync(path.join(r, ".mcp.json"), JSON.stringify({ mcpServers: { other: { command: "x" } } }));
    const first = setupAgents(r, "claude");
    const mcp = JSON.parse(fs.readFileSync(path.join(r, ".mcp.json"), "utf8"));
    assert.ok(mcp.mcpServers.other, "existing server preserved");
    assert.ok(mcp.mcpServers.projectmind, "projectmind added");
    assert.match(fs.readFileSync(path.join(r, "CLAUDE.md"), "utf8"), /projectmind:begin/);

    // idempotent
    const second = setupAgents(r, "claude");
    assert.ok(second.every((x) => x.status === "already"));
    const cnt = (fs.readFileSync(path.join(r, "CLAUDE.md"), "utf8").match(/projectmind:begin/g) || []).length;
    assert.equal(cnt, 1);
  } finally { cleanup(r); }
});

test("setupAgents backs up (never clobbers) an unparseable JSON config", () => {
  const r = tmpRoot();
  try {
    fs.writeFileSync(path.join(r, ".mcp.json"), "{ not json");
    const res = setupAgents(r, "claude");
    const jsonResult = res.find((x) => x.file === ".mcp.json");
    assert.equal(jsonResult.status, "skipped-unparseable");
    assert.ok(jsonResult.backup);
    assert.ok(fs.existsSync(jsonResult.backup));
  } finally { cleanup(r); }
});

test("setupGlobalAgents registers Claude Code via `claude mcp add --scope user`, not a hand-edited file", () => {
  const calls = [];
  const fakeExecFile = (cmd, args) => { calls.push([cmd, args]); return ""; };
  const res = setupGlobalAgents("claude", { homeDir: tmpRoot(), execFile: fakeExecFile });
  assert.equal(res.length, 1);
  assert.equal(res[0].status, "written");
  assert.deepEqual(calls[0][0], "claude");
  assert.deepEqual(calls[0][1], ["mcp", "add", "projectmind", "--scope", "user", "--", "npx", "-y", "@nodemint/projectmind", "mcp"]);
});

test("setupGlobalAgents treats an existing Claude registration as already-done, not a failure", () => {
  const fakeExecFile = () => { const e = new Error("cmd failed"); e.stderr = "Error: MCP server \"projectmind\" already exists"; throw e; };
  const res = setupGlobalAgents("claude", { homeDir: tmpRoot(), execFile: fakeExecFile });
  assert.equal(res[0].status, "already");
});

test("setupGlobalAgents reports a clear error when the claude CLI is missing, without throwing", () => {
  const fakeExecFile = () => { const e = new Error("spawn claude ENOENT"); throw e; };
  const res = setupGlobalAgents("claude", { homeDir: tmpRoot(), execFile: fakeExecFile });
  assert.equal(res[0].status, "failed");
  assert.ok(res[0].error);
});

test("setupGlobalAgents writes Cursor/Windsurf/Gemini configs under the given home dir, not the real one", () => {
  const home = tmpRoot();
  try {
    const res = setupGlobalAgents(["cursor", "windsurf", "gemini"], { homeDir: home });
    assert.equal(res.length, 3);
    assert.ok(fs.existsSync(path.join(home, ".cursor", "mcp.json")));
    assert.ok(fs.existsSync(path.join(home, ".codeium", "windsurf", "mcp_config.json")));
    assert.ok(fs.existsSync(path.join(home, ".gemini", "settings.json")));
    const cursorCfg = JSON.parse(fs.readFileSync(path.join(home, ".cursor", "mcp.json"), "utf8"));
    assert.ok(cursorCfg.mcpServers.projectmind);
    assert.equal(res.find((x) => x.agent === "cursor").file, "~/.cursor/mcp.json");

    // idempotent: running again doesn't duplicate or error
    const second = setupGlobalAgents(["cursor"], { homeDir: home });
    assert.equal(second[0].status, "already");
  } finally { cleanup(home); }
});

test("setupGlobalAgents never touches per-project rules files (CLAUDE.md etc.) — global scope is MCP-only", () => {
  const home = tmpRoot();
  try {
    setupGlobalAgents(["cursor"], { homeDir: home });
    assert.ok(!fs.existsSync(path.join(home, ".cursorrules")));
  } finally { cleanup(home); }
});
