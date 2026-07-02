import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDigest } from "../src/core/index.js";

function mapWith(nodes, extra = {}) {
  return {
    version: 1,
    project: { name: "P", stack: ["node"] },
    nodes,
    edges: [],
    decisions: [],
    conventions: [],
    glossary: {},
    ...extra,
  };
}

test("active vs stable sectioning", () => {
  const d = buildDigest(mapWith({
    a: { type: "module", summary: "A", status: "active" },
    b: { type: "module", summary: "B", status: "stable" },
  }));
  assert.match(d, /## Active[\s\S]*\*\*a\*\*/);
  assert.match(d, /## Modules[\s\S]*\*\*b\*\*/);
});

test("deprecated nodes excluded by default", () => {
  const d = buildDigest(mapWith({
    a: { type: "module", summary: "A", status: "active" },
    old: { type: "module", summary: "OLD", status: "deprecated" },
  }));
  assert.doesNotMatch(d, /OLD/);
  assert.doesNotMatch(d, /\*\*old\*\*/);
});

test("notes and rationale excluded from digest", () => {
  const d = buildDigest(mapWith(
    { a: { type: "module", summary: "A", status: "active", notes: "SECRET_NOTE" } },
    { decisions: [{ id: "d1", text: "decide", rationale: "SECRET_RATIONALE", date: "2026-01-01" }] }
  ));
  assert.doesNotMatch(d, /SECRET_NOTE/);
  assert.doesNotMatch(d, /SECRET_RATIONALE/);
  assert.match(d, /decide/);
});

test("recentDecisions limit honored", () => {
  const decisions = Array.from({ length: 10 }, (_, i) => ({ id: "d" + i, text: "dec" + i, date: "2026-01-01" }));
  const d = buildDigest(mapWith({}, { decisions }), { recentDecisions: 3 });
  assert.match(d, /dec9/);
  assert.match(d, /dec7/);
  assert.doesNotMatch(d, /dec6/); // only last 3 (7,8,9)
});

test("large-project grouping kicks in past maxNodes", () => {
  const nodes = {};
  nodes.act = { type: "module", summary: "active one", status: "active" };
  for (let i = 0; i < 20; i++) nodes["s" + i] = { type: "service", summary: "svc" + i, status: "stable" };
  const d = buildDigest(mapWith(nodes), { maxNodes: 5 });
  assert.match(d, /summarized/);
  assert.match(d, /more nodes/);
  assert.match(d, /\*\*act\*\*/);          // active still listed fully
  assert.doesNotMatch(d, /\*\*s0\*\*/);    // stable ones not listed individually
});

test("edges between excluded nodes are dropped", () => {
  const d = buildDigest(mapWith(
    {
      a: { type: "module", summary: "A", status: "active" },
      old: { type: "module", summary: "O", status: "deprecated" },
    },
    { edges: [{ from: "a", to: "old", rel: "calls" }] }
  ));
  assert.doesNotMatch(d, /## Dependencies/);
});

test("digest is deterministic across runs", () => {
  const m = mapWith({
    z: { type: "module", summary: "Z", status: "active" },
    a: { type: "module", summary: "A", status: "active" },
  });
  assert.equal(buildDigest(m), buildDigest(structuredClone(m)));
});
