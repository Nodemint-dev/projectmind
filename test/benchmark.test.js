import { test } from "node:test";
import assert from "node:assert/strict";
import { runBenchmark, formatReport } from "./benchmark.js";

test("benchmark reports positive savings on the fixture with printed methodology", () => {
  const r = runBenchmark();
  assert.ok(r.baselineTokens > 0, "baseline should read some files");
  assert.ok(r.digestTokens > 0, "digest should be non-empty");
  assert.ok(r.digestTokens < r.baselineTokens, "digest must be smaller than baseline");
  assert.ok(r.savingsPct > 0, "savings must be positive");
  const report = formatReport(r);
  assert.match(report, /Savings:/);
  assert.match(report, /estimate/); // methodology stated
});
