import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { tmpRoot, cleanup } from "./helpers.js";
import { init, patch, load } from "../src/core/index.js";
import { matchNodes, applyFreshness, runPostCommit } from "../src/hooks/postcommit.js";
import { installHook } from "../src/hooks/install.js";

test("matchNodes maps changed files to nodes, including monorepo globs", () => {
  const map = {
    nodes: {
      api: { files: ["packages/*/src/**"] },
      web: { files: ["apps/web/**"] },
      docs: { files: ["README.md"] },
      none: { files: ["nowhere/**"] },
    },
  };
  const changed = ["packages/core/src/index.js", "README.md"];
  const matched = matchNodes(map, changed);
  assert.ok(matched.has("api"));
  assert.ok(matched.has("docs"));
  assert.ok(!matched.has("web"));
  assert.ok(!matched.has("none"));
});

test("applyFreshness bumps status/lastTouched but leaves deprecated nodes", () => {
  const map = { nodes: { a: { status: "stable" }, d: { status: "deprecated" } } };
  applyFreshness(map, new Set(["a", "d"]), "2026-07-01");
  assert.equal(map.nodes.a.status, "active");
  assert.equal(map.nodes.a.lastTouched, "2026-07-01");
  assert.equal(map.nodes.d.status, "deprecated"); // unchanged
  assert.equal(map.nodes.d.lastTouched, "2026-07-01");
});

test("installHook is idempotent and preserves an existing hook", () => {
  const r = tmpRoot();
  try {
    execFileSync("git", ["init", "-q"], { cwd: r });
    const hookFile = path.join(r, ".git", "hooks", "post-commit");
    fs.mkdirSync(path.dirname(hookFile), { recursive: true });
    fs.writeFileSync(hookFile, "#!/bin/sh\necho existing-hook\n");

    const first = installHook(r);
    assert.equal(first.installed, true);
    const content1 = fs.readFileSync(hookFile, "utf8");
    assert.match(content1, /existing-hook/);          // preserved
    assert.match(content1, /projectmind post-commit/); // added

    const second = installHook(r);                     // idempotent
    assert.equal(second.alreadyInstalled, true);
    assert.equal(fs.readFileSync(hookFile, "utf8"), content1);
  } finally { cleanup(r); }
});

test("end-to-end: real commit triggers freshness bump via the hook", () => {
  const r = tmpRoot();
  try {
    execFileSync("git", ["init", "-q"], { cwd: r });
    execFileSync("git", ["config", "user.email", "t@t.co"], { cwd: r });
    execFileSync("git", ["config", "user.name", "t"], { cwd: r });
    init(r);
    patch({ node: { id: "auth", summary: "auth", status: "stable", files: ["src/auth.js"] } }, r);
    installHook(r);

    fs.mkdirSync(path.join(r, "src"), { recursive: true });
    fs.writeFileSync(path.join(r, "src", "auth.js"), "export const x = 1;\n");
    execFileSync("git", ["add", "."], { cwd: r });
    execFileSync("git", ["commit", "-q", "-m", "touch auth"], { cwd: r });

    const n = load(r).nodes.auth;
    assert.equal(n.status, "active"); // bumped from stable by the hook
  } finally { cleanup(r); }
});

test("runPostCommit never throws and returns a reason when there is no map", () => {
  const r = tmpRoot();
  try {
    const res = runPostCommit(r);
    assert.equal(res.updated, false);
  } finally { cleanup(r); }
});
