// Benchmark — proves the token savings with a real, reproducible number.
//
// Methodology (honest, auditable):
//  - Baseline: the tokens an agent would spend to understand the project the
//    old way — reading the files it would most likely open on session start:
//    the README, package manifest, and every source file under src/. We sum
//    estimateTokens() over their raw contents.
//  - projectmind: the tokens of digest() — the one small document the agent
//    reads instead.
//  - estimateTokens uses ~4 chars/token, the rough Claude/GPT average for
//    English + code. Everything below is labelled "estimated".
//
// Run: `npm run benchmark` (or `node test/benchmark.js`).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { digest, estimateTokens, stats } from "../src/core/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, "fixtures", "sample-project");

// Files an agent would plausibly read to orient itself the old way.
function baselineFiles(dir) {
  const files = [];
  const top = ["README.md", "package.json"];
  for (const f of top) {
    const p = path.join(dir, f);
    if (fs.existsSync(p)) files.push(p);
  }
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.(js|ts|jsx|tsx|mjs|cjs)$/.test(entry.name)) files.push(p);
    }
  };
  const src = path.join(dir, "src");
  if (fs.existsSync(src)) walk(src);
  return files;
}

export function runBenchmark(dir = fixture) {
  const files = baselineFiles(dir);
  let baselineTokens = 0;
  for (const f of files) baselineTokens += estimateTokens(fs.readFileSync(f, "utf8"));

  const d = digest(dir);
  const digestTokens = estimateTokens(d);
  const savingsPct = baselineTokens > 0 ? 1 - digestTokens / baselineTokens : 0;

  return {
    name: path.basename(dir),
    files: files.map((f) => path.relative(dir, f)),
    baselineTokens,
    digestTokens,
    savedTokens: baselineTokens - digestTokens,
    savingsPct,
    stats: stats(dir),
  };
}

export function formatReport(r) {
  const pct = (r.savingsPct * 100).toFixed(1);
  return [
    `Project: ${r.name}`,
    `Baseline (files an agent would read):  ~${r.baselineTokens} tokens  (${r.files.length} files)`,
    `projectmind digest:                    ~${r.digestTokens} tokens`,
    `Savings:                               ${pct}%  (~${r.savedTokens} tokens/session)`,
    ``,
    `Assumptions: baseline = README + package.json + all src/*.{js,ts,...};`,
    `token estimate = ceil(chars / 4). Numbers are estimates, not exact counts.`,
    `Baseline files: ${r.files.join(", ")}`,
  ].join("\n");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = runBenchmark();
  console.log(formatReport(r));
}
