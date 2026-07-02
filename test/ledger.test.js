import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRoot, cleanup } from "./helpers.js";
import { init, patch, ensureLocalGitignored } from "../src/core/index.js";
import {
  recordRead, loadLedger, savingsSummary, baselineEstimate,
  scopedBaselineEstimate, recordDigestRead,
} from "../src/core/ledger.js";

function scaffold(r) {
  fs.mkdirSync(path.join(r, "src"), { recursive: true });
  fs.writeFileSync(path.join(r, "src", "a.js"), "x".repeat(4000)); // ~1000 tokens
  fs.writeFileSync(path.join(r, "src", "b.js"), "y".repeat(2000)); // ~500 tokens
  fs.writeFileSync(path.join(r, "README.md"), "z".repeat(400));    // ~100 tokens
}

test("recordRead aggregates totals, byTool, and days; floors savings at zero", () => {
  const r = tmpRoot();
  try {
    init(r);
    recordRead({ tool: "mind_digest", served: 100, baseline: 1100 }, r);
    recordRead({ tool: "mind_digest", served: 100, baseline: 1100 }, r);
    recordRead({ tool: "mind_query", served: 500, baseline: 200 }, r); // bigger than baseline
    const l = loadLedger(r);
    assert.equal(l.totals.reads, 3);
    assert.equal(l.totals.tokensSavedEst, 2000);          // 1000 + 1000 + 0 (floored)
    assert.equal(l.byTool.mind_digest.reads, 2);
    assert.equal(l.byTool.mind_query.tokensSavedEst, 0);
    const day = Object.keys(l.days)[0];
    assert.equal(l.days[day].reads, 3);
  } finally { cleanup(r); }
});

test("baselineEstimate counts code + docs; scoped baseline honors globs", () => {
  const r = tmpRoot();
  try {
    scaffold(r);
    const b = baselineEstimate(r);
    assert.ok(b.tokens >= 1600, `expected ~1600 tokens, got ${b.tokens}`);
    assert.equal(b.files, 3);
    const scoped = scopedBaselineEstimate(["src/a.js"], r);
    assert.equal(scoped.files, 1);
    assert.equal(scoped.tokens, 1000);
  } finally { cleanup(r); }
});

test("recordDigestRead computes a positive saving on a real repo", () => {
  const r = tmpRoot();
  try {
    scaffold(r);
    init(r);
    patch({ node: { id: "src", summary: "the source", files: ["src/**"] } }, r);
    const { saved } = recordDigestRead("# tiny digest\n", r);
    assert.ok(saved > 0, "digest should be cheaper than the repo scan");
  } finally { cleanup(r); }
});

test("savingsSummary converts to dollars when a price is set, and labels estimates", () => {
  const r = tmpRoot();
  try {
    init(r);
    recordRead({ tool: "mind_digest", served: 0, baseline: 2_000_000 }, r);
    const s = savingsSummary(r, { pricePerMTok: 3 });
    assert.equal(s.estimated, true);
    assert.equal(s.dollarsSavedEst, 6);
    assert.match(s.methodology, /estimate|≈|bytes/i);
    const noPrices = savingsSummary(r, {});
    assert.equal(noPrices.dollarsSavedEst, undefined);
  } finally { cleanup(r); }
});

test("corrupt ledger self-heals to empty (never crashes a read)", () => {
  const r = tmpRoot();
  try {
    init(r);
    fs.writeFileSync(path.join(r, ".projectmind", "ledger.json"), "{ nope");
    const l = loadLedger(r);
    assert.equal(l.totals.reads, 0);
    // and recording on top of the corrupt file works
    const { totals } = recordRead({ tool: "mind_digest", served: 1, baseline: 2 }, r);
    assert.equal(totals.reads, 1);
  } finally { cleanup(r); }
});

test("init gitignores the ledger alongside the local overlay", () => {
  const r = tmpRoot();
  try {
    init(r);
    ensureLocalGitignored(r);
    const gi = fs.readFileSync(path.join(r, ".gitignore"), "utf8");
    assert.match(gi, /\.projectmind\/ledger\.json/);
    assert.match(gi, /\.projectmind\/map\.local\.json/);
  } finally { cleanup(r); }
});
