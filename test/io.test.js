import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRoot, cleanup } from "./helpers.js";
import { init, load, save, patch, serialize, DIR, MAP } from "../src/core/index.js";

test("save then load round-trips to an equal map", () => {
  const r = tmpRoot();
  try {
    init(r);
    patch({ node: { id: "a", summary: "A", status: "stable" }, stack: ["node"] }, r);
    const first = load(r);
    const reloaded = load(r);
    assert.deepEqual(reloaded, first);
  } finally { cleanup(r); }
});

test("serialize is stable (sorted keys) across runs", () => {
  const m = { version: 1, project: { stack: [], name: "p" }, nodes: { b: { summary: "B", type: "module" }, a: { summary: "A", type: "module" } }, edges: [], decisions: [], conventions: [], glossary: {} };
  const a = serialize(m);
  const b = serialize(structuredClone(m));
  assert.equal(a, b);
  // project keys sorted: name before stack
  assert.ok(a.indexOf('"name"') < a.indexOf('"stack"'));
});

test("corrupt map.json self-heals: empty map returned + .corrupt backup written", () => {
  const r = tmpRoot();
  try {
    init(r);
    const mp = path.join(r, DIR, MAP);
    fs.writeFileSync(mp, "{ this is not json ");
    const m = load(r);          // must not throw
    assert.equal(m.version, 1);
    assert.deepEqual(m.nodes, {});
    const backups = fs.readdirSync(path.join(r, DIR)).filter((f) => f.includes(".corrupt-"));
    assert.ok(backups.length >= 1, "expected a .corrupt- backup file");
  } finally { cleanup(r); }
});

test("schema-invalid map.json also self-heals", () => {
  const r = tmpRoot();
  try {
    init(r);
    const mp = path.join(r, DIR, MAP);
    fs.writeFileSync(mp, JSON.stringify({ version: 99 }));
    const m = load(r);
    assert.equal(m.version, 1);
    const backups = fs.readdirSync(path.join(r, DIR)).filter((f) => f.includes(".corrupt-"));
    assert.ok(backups.length >= 1);
  } finally { cleanup(r); }
});

test("save rejects an invalid map (never writes it)", () => {
  const r = tmpRoot();
  try {
    init(r);
    assert.throws(() => save({ version: 1, project: {}, nodes: {}, edges: [{ from: "a", to: "b", rel: "x" }], decisions: [], conventions: [] }, r), /invalid map/);
  } finally { cleanup(r); }
});

test("digest.md is written alongside map.json on save", () => {
  const r = tmpRoot();
  try {
    init(r);
    assert.ok(fs.existsSync(path.join(r, DIR, "digest.md")));
  } finally { cleanup(r); }
});
