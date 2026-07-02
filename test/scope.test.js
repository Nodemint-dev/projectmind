import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRoot, cleanup } from "./helpers.js";
import { init, patch, load, digest, DIR, LOCAL, MAP } from "../src/core/index.js";

test("local overlay merges over repo map in the read view", () => {
  const r = tmpRoot();
  try {
    init(r);
    patch({ node: { id: "auth", summary: "repo auth", status: "stable" } }, r); // repo
    patch({ node: { id: "scratch", summary: "mid refactor", status: "active" } }, r, { scope: "local" });
    const m = load(r);
    assert.ok(m.nodes.auth, "repo node present");
    assert.ok(m.nodes.scratch, "local node present");
    // local write must NOT be in repo map.json
    const repo = JSON.parse(fs.readFileSync(path.join(r, DIR, MAP), "utf8"));
    assert.equal(repo.nodes.scratch, undefined);
    // it lives in the (gitignored) local file
    const local = JSON.parse(fs.readFileSync(path.join(r, DIR, LOCAL), "utf8"));
    assert.ok(local.nodes.scratch);
  } finally { cleanup(r); }
});

test("local node with same id overrides repo node in merged view", () => {
  const r = tmpRoot();
  try {
    init(r);
    patch({ node: { id: "x", summary: "repo version", status: "stable" } }, r);
    patch({ node: { id: "x", summary: "local override", status: "active" } }, r, { scope: "local" });
    assert.equal(load(r).nodes.x.summary, "local override");
  } finally { cleanup(r); }
});

test("committed digest.md reflects repo only, not local overlay", () => {
  const r = tmpRoot();
  try {
    init(r);
    patch({ node: { id: "shared", summary: "shared node", status: "active" } }, r);
    patch({ node: { id: "personal", summary: "PERSONAL_SECRET", status: "active" } }, r, { scope: "local" });
    const committed = fs.readFileSync(path.join(r, DIR, "digest.md"), "utf8");
    assert.doesNotMatch(committed, /PERSONAL_SECRET/);
    // but the live digest() (merged) does include it
    assert.match(digest(r), /PERSONAL_SECRET/);
  } finally { cleanup(r); }
});

test("init adds local overlay to .gitignore", () => {
  const r = tmpRoot();
  try {
    init(r);
    const gi = fs.readFileSync(path.join(r, ".gitignore"), "utf8");
    assert.match(gi, new RegExp(`${DIR}/${LOCAL}`.replace(/[.]/g, "\\.")));
  } finally { cleanup(r); }
});
