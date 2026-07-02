import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRoot, cleanup } from "./helpers.js";
import { init, setHandoff, clearHandoff, getHandoff, digest, DIR, MAP, LOCAL } from "../src/core/index.js";
import { resolvePrice, MODEL_INPUT_PRICES } from "../src/core/ledger.js";

test("handoff leads the digest and clears cleanly", () => {
  const r = tmpRoot();
  try {
    init(r);
    setHandoff("Refactoring auth to refresh tokens; next: fix test/auth.test.js", r);
    const d = digest(r);
    assert.match(d, /Handoff from last session/);
    assert.match(d, /refresh tokens/);
    // it appears BEFORE the module sections
    assert.ok(d.indexOf("Handoff") < d.indexOf("mind_query"));

    assert.equal(getHandoff(r).text.includes("refresh tokens"), true);

    clearHandoff(r);
    assert.equal(getHandoff(r), null);
    assert.doesNotMatch(digest(r), /Handoff from last session/);
  } finally { cleanup(r); }
});

test("handoff is stored in the local overlay, never the committed map", () => {
  const r = tmpRoot();
  try {
    init(r);
    setHandoff("PERSONAL_WIP_NOTE", r);
    const repo = JSON.parse(fs.readFileSync(path.join(r, DIR, MAP), "utf8"));
    assert.equal(repo.handoff, undefined);
    const local = JSON.parse(fs.readFileSync(path.join(r, DIR, LOCAL), "utf8"));
    assert.equal(local.handoff.text, "PERSONAL_WIP_NOTE");
    assert.ok(local.handoff.date);
    // committed digest.md must not leak it either
    const committedDigest = fs.readFileSync(path.join(r, DIR, "digest.md"), "utf8");
    assert.doesNotMatch(committedDigest, /PERSONAL_WIP_NOTE/);
  } finally { cleanup(r); }
});

test("resolvePrice: zero-config default is sonnet-tier; overrides win", () => {
  const def = resolvePrice({});
  assert.equal(def.price, MODEL_INPUT_PRICES.sonnet);
  assert.match(def.label, /sonnet/);

  const opus = resolvePrice({ model: "opus" });
  assert.equal(opus.price, MODEL_INPUT_PRICES.opus);

  const custom = resolvePrice({ inputPricePerMTok: 7.5 });
  assert.equal(custom.price, 7.5);
  assert.match(custom.label, /configured/);

  const bogus = resolvePrice({ model: "not-a-model" });
  assert.equal(bogus.price, MODEL_INPUT_PRICES.sonnet); // safe fallback
});
