// Savings ledger — local, gitignored proof of what projectmind saved you.
//
// Every time an agent reads the map instead of scanning files (via the MCP
// server), we record: tokens actually served vs. the estimated tokens the
// agent would have read without the map. The difference is the saving.
//
// Honesty rules:
//  - Everything is an ESTIMATE (ceil(bytes / 4), same methodology as the
//    benchmark) and is labelled as such everywhere it surfaces.
//  - The ledger lives in .projectmind/ledger.json, is gitignored, never
//    leaves your machine, and can be deleted at any time.
//  - Savings are floored at zero: if a response is bigger than the scan it
//    replaced, we record zero saved, not negative noise.
import fs from "node:fs";
import path from "node:path";
import picomatch from "picomatch";
import { root, walkFiles, estimateTokens, DIR } from "./index.js";

export const LEDGER = "ledger.json";
const ledgerPath = (r) => path.join(r, DIR, LEDGER);

// Built-in input prices in USD per million tokens, from Anthropic's published
// pricing as of June 2026 (Haiku 4.5 / Sonnet / Opus / Fable input rates).
// Used ONLY to translate the local ledger into approximate dollars. Zero
// config needed: we default to the Sonnet tier — the typical coding-agent
// model class — and label the assumption everywhere it surfaces. Override in
// .projectmind/config.json with savings.model ("haiku"|"sonnet"|"opus"|"fable")
// or an exact savings.inputPricePerMTok.
export const MODEL_INPUT_PRICES = { haiku: 1, sonnet: 3, opus: 5, fable: 10 };
export const DEFAULT_PRICE_MODEL = "sonnet";
export const PRICES_AS_OF = "2026-06";

export function resolvePrice(savingsCfg = {}) {
  if (Number.isFinite(savingsCfg.inputPricePerMTok)) {
    return { price: savingsCfg.inputPricePerMTok, label: `your configured rate ($${savingsCfg.inputPricePerMTok}/MTok input)` };
  }
  const model = MODEL_INPUT_PRICES[savingsCfg.model] != null ? savingsCfg.model : DEFAULT_PRICE_MODEL;
  return {
    price: MODEL_INPUT_PRICES[model],
    label: `${model}-tier input pricing ($${MODEL_INPUT_PRICES[model]}/MTok, as of ${PRICES_AS_OF})`,
  };
}

const emptyLedger = () => ({
  version: 1,
  totals: { reads: 0, tokensServed: 0, tokensBaselineEst: 0, tokensSavedEst: 0 },
  byTool: {},
  days: {},
});

const today = () => new Date().toISOString().slice(0, 10);

// Source files an agent would plausibly read to orient itself — same shape as
// the benchmark baseline: docs + manifests + code files.
const CODE_OR_DOC = /\.(js|jsx|ts|tsx|mjs|cjs|py|go|rs|rb|php|java|kt|swift|dart|c|cc|cpp|h|hpp|cs|scala|ex|exs|md|json|ya?ml|toml)$/i;

function fileTokens(r, rel) {
  try {
    return Math.ceil(fs.statSync(path.join(r, rel)).size / 4);
  } catch {
    return 0;
  }
}

// Cache the whole-repo baseline per process (the MCP server is long-lived);
// recomputing a big walk on every tool call would be wasteful.
const baselineCache = new Map(); // root -> { at, tokens, files }
const BASELINE_TTL_MS = 60_000;

export function baselineEstimate(r = root()) {
  const hit = baselineCache.get(r);
  if (hit && Date.now() - hit.at < BASELINE_TTL_MS) return hit;
  const files = walkFiles(r).filter((f) => CODE_OR_DOC.test(f));
  let tokens = 0;
  for (const f of files) tokens += fileTokens(r, f);
  const entry = { at: Date.now(), tokens, files: files.length };
  baselineCache.set(r, entry);
  return entry;
}

// Baseline for a scoped read (mind_query / mind_context): only the files the
// served nodes cover — what the agent would have opened to get that detail.
export function scopedBaselineEstimate(globs, r = root()) {
  if (!globs || !globs.length) return { tokens: 0, files: 0 };
  const isMatch = picomatch(globs, { dot: true });
  const files = walkFiles(r).filter((f) => isMatch(f));
  let tokens = 0;
  for (const f of files) tokens += fileTokens(r, f);
  return { tokens, files: files.length };
}

export function loadLedger(r = root()) {
  try {
    const l = JSON.parse(fs.readFileSync(ledgerPath(r), "utf8"));
    if (l?.version !== 1 || !l.totals || !l.days) return emptyLedger();
    return l;
  } catch {
    return emptyLedger();
  }
}

function atomicWrite(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

// Record one read. `served` = tokens the agent actually received from the
// tool; `baseline` = estimated tokens of the files it would have read instead.
export function recordRead({ tool, served, baseline }, r = root()) {
  const l = loadLedger(r);
  const saved = Math.max(0, (baseline || 0) - (served || 0));
  const bump = (slot) => {
    slot.reads += 1;
    slot.tokensServed += served || 0;
    slot.tokensBaselineEst += baseline || 0;
    slot.tokensSavedEst += saved;
  };
  bump(l.totals);
  l.byTool[tool] = l.byTool[tool] || { reads: 0, tokensServed: 0, tokensBaselineEst: 0, tokensSavedEst: 0 };
  bump(l.byTool[tool]);
  const d = today();
  l.days[d] = l.days[d] || { reads: 0, tokensServed: 0, tokensBaselineEst: 0, tokensSavedEst: 0 };
  bump(l.days[d]);
  try {
    atomicWrite(ledgerPath(r), JSON.stringify(l, null, 2) + "\n");
  } catch { /* never let bookkeeping break a read */ }
  return { saved, totals: l.totals };
}

// Convenience wrappers used by the MCP server -------------------------------

export function recordDigestRead(digestText, r = root()) {
  const served = estimateTokens(digestText);
  const { tokens } = baselineEstimate(r);
  return recordRead({ tool: "mind_digest", served, baseline: tokens }, r);
}

export function recordScopedRead(tool, responseText, globs, r = root()) {
  const served = estimateTokens(responseText);
  const { tokens } = scopedBaselineEstimate(globs, r);
  return recordRead({ tool, served, baseline: tokens }, r);
}

// Summary for `projectmind savings`, mind_stats, and the VS Code status bar.
// Dollars work with zero configuration: pass the resolvePrice() result, or a
// raw pricePerMTok for tests/back-compat.
export function savingsSummary(r = root(), { pricePerMTok = null, priceLabel = null } = {}) {
  const l = loadLedger(r);
  const days = Object.keys(l.days).sort();
  const last7 = days.slice(-7).map((d) => ({ date: d, ...l.days[d] }));
  const summary = {
    estimated: true,
    methodology: "tokens ≈ ceil(bytes/4); baseline = files the agent would have read instead",
    totals: l.totals,
    today: l.days[today()] || { reads: 0, tokensServed: 0, tokensBaselineEst: 0, tokensSavedEst: 0 },
    last7,
    byTool: l.byTool,
  };
  if (pricePerMTok != null && Number.isFinite(pricePerMTok)) {
    summary.dollarsSavedEst = +(l.totals.tokensSavedEst / 1_000_000 * pricePerMTok).toFixed(4);
    summary.pricePerMTok = pricePerMTok;
    if (priceLabel) summary.priceLabel = priceLabel;
  }
  return summary;
}
