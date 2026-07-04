import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRoot, cleanup } from "./helpers.js";
import {
  init, patch, load, detectStack, proposeSeed, seed, drift,
  buildContext, context, hasCodegraph, digest, query, stats,
  embedDigestBlock, committedDigest, embeddedDigestFiles,
  RULES_MARKER_BEGIN, RULES_MARKER_END, DIGEST_BLOCK_BEGIN, DIGEST_BLOCK_END,
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

// ---------------------------------------------------------------------------
// Universal digest embedding — the fix for "the model didn't choose to call
// mind_digest": rules files (CLAUDE.md, .cursorrules, ...) are loaded into
// context by every agent unconditionally, so embedding the actual digest
// content there (kept in sync automatically) works regardless of whether the
// model decides to call a tool.
// ---------------------------------------------------------------------------

test("embedDigestBlock never touches a file that hasn't run setup (no static marker)", () => {
  const content = "# My repo\n\nSome existing notes.\n";
  assert.equal(embedDigestBlock(content, "# digest text"), content);
});

test("embedDigestBlock inserts the digest block right after the static instructions end marker", () => {
  const content = `${RULES_MARKER_BEGIN}\nsome instructions\n${RULES_MARKER_END}\n`;
  const out = embedDigestBlock(content, "# my digest\nhello");
  assert.match(out, /some instructions/);
  assert.match(out, new RegExp(`${RULES_MARKER_END}[\\s\\S]*${DIGEST_BLOCK_BEGIN}[\\s\\S]*# my digest\\nhello[\\s\\S]*${DIGEST_BLOCK_END}`));
  // static markers untouched, exactly one of each
  assert.equal((out.match(/projectmind:begin/g) || []).length, 1);
});

test("embedDigestBlock replaces an existing digest block in place, idempotently, without duplicating or drifting", () => {
  const content = `${RULES_MARKER_BEGIN}\ninstructions\n${RULES_MARKER_END}\n\n${DIGEST_BLOCK_BEGIN}\nOLD DIGEST\n${DIGEST_BLOCK_END}\n`;
  const out = embedDigestBlock(content, "NEW DIGEST");
  assert.doesNotMatch(out, /OLD DIGEST/);
  assert.match(out, /NEW DIGEST/);
  assert.equal((out.match(new RegExp(DIGEST_BLOCK_BEGIN, "g")) || []).length, 1);

  // idempotent: embedding the same text twice produces identical output
  const again = embedDigestBlock(out, "NEW DIGEST");
  assert.equal(again, out);
});

test("committedDigest never includes local-overlay content — safe to embed in a committed file", () => {
  const r = tmpRoot();
  try {
    init(r);
    patch({ node: { id: "shared", summary: "shared node", status: "active" } }, r);
    patch({ node: { id: "personal", summary: "PERSONAL_SECRET_WIP" }, handoff: "PERSONAL_HANDOFF_NOTE" }, r, { scope: "local" });
    const cd = committedDigest(r);
    assert.match(cd, /shared node/);
    assert.doesNotMatch(cd, /PERSONAL_SECRET_WIP/);
    assert.doesNotMatch(cd, /PERSONAL_HANDOFF_NOTE/);
  } finally { cleanup(r); }
});

test("setupAgents embeds a real digest immediately on first run, not just an instruction to fetch one", () => {
  const r = tmpRoot();
  try {
    scaffoldRepo(r);
    init(r);
    patch({ node: { id: "src", summary: "the source tree", status: "active" } }, r);
    setupAgents(r, "claude");
    const claudeMd = fs.readFileSync(path.join(r, "CLAUDE.md"), "utf8");
    assert.match(claudeMd, new RegExp(DIGEST_BLOCK_BEGIN));
    assert.match(claudeMd, /the source tree/);
  } finally { cleanup(r); }
});

test("save() keeps every already-set-up rules file's embedded digest in sync automatically", () => {
  const r = tmpRoot();
  try {
    scaffoldRepo(r);
    init(r);
    setupAgents(r, ["claude", "cursor"]);
    // a structural change via a normal patch — the real path mind_update/CLI/git-hook/watch all use
    patch({ node: { id: "billing", summary: "handles invoices", status: "active" } }, r);

    const claudeMd = fs.readFileSync(path.join(r, "CLAUDE.md"), "utf8");
    const cursorrules = fs.readFileSync(path.join(r, ".cursorrules"), "utf8");
    assert.match(claudeMd, /handles invoices/);
    assert.match(cursorrules, /handles invoices/);

    // another change — the embedded digest must reflect the LATEST state, not stack up old ones
    patch({ node: { id: "billing", summary: "handles invoices and refunds" } }, r);
    const updated = fs.readFileSync(path.join(r, "CLAUDE.md"), "utf8");
    assert.match(updated, /handles invoices and refunds/);
    assert.equal((updated.match(new RegExp(DIGEST_BLOCK_BEGIN, "g")) || []).length, 1);
  } finally { cleanup(r); }
});

test("save() never touches a rules file for an agent that was never set up", () => {
  const r = tmpRoot();
  try {
    scaffoldRepo(r);
    init(r);
    setupAgents(r, "claude"); // only claude, not cursor
    patch({ node: { id: "auth", summary: "auth stuff", status: "active" } }, r);
    assert.ok(!fs.existsSync(path.join(r, ".cursorrules")), "save() must not spontaneously create rules files");
  } finally { cleanup(r); }
});

test("save() never embeds local-scope (personal) content into a committed rules file", () => {
  const r = tmpRoot();
  try {
    scaffoldRepo(r);
    init(r);
    setupAgents(r, "claude");
    patch({ handoff: "PERSONAL_WIP_LEAK_CHECK" }, r, { scope: "local" });
    const claudeMd = fs.readFileSync(path.join(r, "CLAUDE.md"), "utf8");
    assert.doesNotMatch(claudeMd, /PERSONAL_WIP_LEAK_CHECK/);
  } finally { cleanup(r); }
});

test("embeddedDigestFiles reports which rules files carry an embedded digest, and stats() surfaces it", () => {
  const r = tmpRoot();
  try {
    scaffoldRepo(r);
    init(r);
    assert.deepEqual(embeddedDigestFiles(r), [], "nothing embedded before setup runs");

    setupAgents(r, ["claude", "cursor"]);
    const after = embeddedDigestFiles(r);
    assert.ok(after.includes("CLAUDE.md"));
    assert.ok(after.includes(".cursorrules"));
    assert.ok(!after.includes(".windsurfrules"), "agent never set up must not be reported");

    assert.deepEqual(stats(r).embeddedDigestIn.sort(), after.sort());
  } finally { cleanup(r); }
});

test("proposeSeed descends through a bare src/ wrapper instead of collapsing an entire Next.js-style app into one blob node", () => {
  const r = tmpRoot();
  try {
    fs.writeFileSync(path.join(r, "package.json"), JSON.stringify({ name: "volte", description: "ecommerce storefront" }));
    // mirrors a real src-layout Next.js app: everything nested under src/,
    // which used to collapse into a single undifferentiated "src" node
    const files = [
      "src/app/(storefront)/checkout/page.tsx",
      "src/app/(storefront)/cart/page.tsx",
      "src/app/admin/products/page.tsx",
      "src/app/admin/orders/page.tsx",
      "src/lib/courier/manual.ts",
      "src/lib/courier/adapter.ts",
      "src/lib/email/console-stub.ts",
      "src/components/Button.tsx",
      "src/components/ProductCard.tsx",
    ];
    for (const f of files) {
      fs.mkdirSync(path.join(r, path.dirname(f)), { recursive: true });
      fs.writeFileSync(path.join(r, f), "export const x = 1;\n");
    }
    const p = proposeSeed(r);
    assert.ok(!p.nodes.src, "must not collapse everything into one src blob");
    assert.ok(p.nodes.app, "expected a node for src/app");
    assert.ok(p.nodes.lib, "expected a node for src/lib");
    assert.ok(p.nodes.components, "expected a node for src/components");
    assert.deepEqual(p.nodes.app.files, ["src/app/**"]);
    assert.deepEqual(p.nodes.lib.files, ["src/lib/**"]);
    // 4 files under app/, 3 under lib/, 2 under components/
    assert.match(p.nodes.app.summary, /4 source files/);
    assert.match(p.nodes.lib.summary, /3 source files/);
  } finally { cleanup(r); }
});

test("proposeSeed still groups loose files sitting directly in src/ under a plain src node", () => {
  const r = tmpRoot();
  try {
    fs.mkdirSync(path.join(r, "src"), { recursive: true });
    fs.writeFileSync(path.join(r, "src", "index.js"), "export const a = 1;\n");
    fs.writeFileSync(path.join(r, "src", "utils.js"), "export const b = 2;\n");
    const p = proposeSeed(r);
    assert.ok(p.nodes.src);
    assert.deepEqual(p.nodes.src.files, ["src/**"]);
  } finally { cleanup(r); }
});
