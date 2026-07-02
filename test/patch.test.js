import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpRoot, cleanup } from "./helpers.js";
import { init, patch, load, query } from "../src/core/index.js";

test("add node, then update merges (not replaces)", () => {
  const r = tmpRoot();
  try {
    init(r);
    patch({ node: { id: "auth", summary: "auth stuff", notes: "long note" } }, r);
    patch({ node: { id: "auth", status: "stable" } }, r);
    const n = query("auth", r);
    assert.equal(n.summary, "auth stuff");      // preserved
    assert.equal(n.notes, "long note");          // preserved
    assert.equal(n.status, "stable");            // updated
    assert.ok(n.lastTouched);
  } finally { cleanup(r); }
});

test("removeNode also removes its edges", () => {
  const r = tmpRoot();
  try {
    init(r);
    patch({ node: { id: "a", summary: "A" } }, r);
    patch({ node: { id: "b", summary: "B" } }, r);
    patch({ edge: { from: "a", to: "b", rel: "calls" } }, r);
    patch({ removeNode: "b" }, r);
    const m = load(r);
    assert.equal(m.nodes.b, undefined);
    assert.equal(m.edges.length, 0);
  } finally { cleanup(r); }
});

test("edge de-dup", () => {
  const r = tmpRoot();
  try {
    init(r);
    patch({ node: { id: "a", summary: "A" } }, r);
    patch({ node: { id: "b", summary: "B" } }, r);
    patch({ edge: { from: "a", to: "b", rel: "calls" } }, r);
    patch({ edge: { from: "a", to: "b", rel: "calls" } }, r);
    assert.equal(load(r).edges.length, 1);
  } finally { cleanup(r); }
});

test("removeEdge removes only the matching edge", () => {
  const r = tmpRoot();
  try {
    init(r);
    patch({ node: { id: "a", summary: "A" } }, r);
    patch({ node: { id: "b", summary: "B" } }, r);
    patch({ edge: { from: "a", to: "b", rel: "calls" } }, r);
    patch({ edge: { from: "a", to: "b", rel: "depends-on" } }, r);
    patch({ removeEdge: { from: "a", to: "b", rel: "calls" } }, r);
    const m = load(r);
    assert.equal(m.edges.length, 1);
    assert.equal(m.edges[0].rel, "depends-on");
  } finally { cleanup(r); }
});

test("decision auto-id increments and dates", () => {
  const r = tmpRoot();
  try {
    init(r);
    patch({ decision: { text: "first" } }, r);
    patch({ decision: "second" }, r); // string form
    const m = load(r);
    assert.equal(m.decisions.length, 2);
    assert.equal(m.decisions[0].id, "d1");
    assert.equal(m.decisions[1].id, "d2");
    assert.equal(m.decisions[1].text, "second");
    assert.ok(m.decisions[0].date);
  } finally { cleanup(r); }
});

test("convention de-dup", () => {
  const r = tmpRoot();
  try {
    init(r);
    patch({ convention: "use tabs" }, r);
    patch({ convention: "use tabs" }, r);
    assert.equal(load(r).conventions.length, 1);
  } finally { cleanup(r); }
});

test("stack set-union", () => {
  const r = tmpRoot();
  try {
    init(r);
    patch({ stack: ["node", "postgres"] }, r);
    patch({ stack: ["postgres", "redis"] }, r);
    assert.deepEqual(load(r).project.stack.sort(), ["node", "postgres", "redis"]);
  } finally { cleanup(r); }
});

test("glossary merge", () => {
  const r = tmpRoot();
  try {
    init(r);
    patch({ glossary: { A: "a" } }, r);
    patch({ glossary: { B: "b" } }, r);
    assert.deepEqual(load(r).glossary, { A: "a", B: "b" });
  } finally { cleanup(r); }
});
