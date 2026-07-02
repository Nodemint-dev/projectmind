import { test } from "node:test";
import assert from "node:assert/strict";
import { validate } from "../src/core/index.js";

const good = () => ({
  version: 1,
  project: { name: "x", stack: [] },
  nodes: { a: { type: "module", summary: "s", status: "active" } },
  edges: [],
  decisions: [],
  conventions: [],
  glossary: {},
});

test("valid map passes", () => {
  assert.equal(validate(good()).valid, true);
});

test("missing version fails", () => {
  const m = good(); delete m.version;
  const v = validate(m);
  assert.equal(v.valid, false);
  assert.match(v.errors.join(), /version/);
});

test("non-object map fails clearly", () => {
  const v = validate(null);
  assert.equal(v.valid, false);
  assert.match(v.errors.join(), /object/);
});

test("missing project.name fails", () => {
  const m = good(); delete m.project.name;
  assert.equal(validate(m).valid, false);
});

test("bad node (no summary) fails", () => {
  const m = good(); m.nodes.b = { type: "module" };
  const v = validate(m);
  assert.equal(v.valid, false);
  assert.match(v.errors.join(), /summary/);
});

test("bad node status fails", () => {
  const m = good(); m.nodes.a.status = "wat";
  assert.equal(validate(m).valid, false);
});

test("dangling edge referencing unknown node fails", () => {
  const m = good(); m.edges.push({ from: "a", to: "ghost", rel: "calls" });
  const v = validate(m);
  assert.equal(v.valid, false);
  assert.match(v.errors.join(), /unknown node/);
});

test("dangling edge allowed when allowDanglingEdges is set (local scope)", () => {
  const m = good(); m.edges.push({ from: "a", to: "ghost", rel: "calls" });
  assert.equal(validate(m, { allowDanglingEdges: true }).valid, true);
});

test("edge without string fields fails", () => {
  const m = good(); m.edges.push({ from: "a", to: 5 });
  assert.equal(validate(m).valid, false);
});
