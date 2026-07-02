// Watch mode — live file→module freshness without needing a commit. Pure-local,
// zero LLM. Debounces bursts of changes, maps them to nodes via their file
// globs, bumps status/lastTouched. Same reconcile logic as the git hook.
import fs from "node:fs";
import path from "node:path";
import { root, loadScope, save, DIR } from "../core/index.js";
import { matchNodes, applyFreshness } from "../hooks/postcommit.js";

const IGNORE = new Set([".git", DIR, ".codegraph", "node_modules", "dist", "build", ".next", "coverage"]);

// Pure: given a batch of changed repo-relative paths, bump matching nodes and
// persist. Returns the ids that were bumped (empty if none). Never throws.
export function reconcile(r, changedFiles) {
  try {
    if (!fs.existsSync(path.join(r, DIR, "map.json"))) return [];
    const map = loadScope("repo", r);
    const matched = matchNodes(map, changedFiles);
    if (!matched.size) return [];
    applyFreshness(map, matched);
    save(map, r, "repo");
    return [...matched];
  } catch {
    return [];
  }
}

export function watch(r = root(), { debounceMs = 300, onUpdate, signal } = {}) {
  const pending = new Set();
  let timer = null;

  const flush = () => {
    timer = null;
    const batch = [...pending];
    pending.clear();
    const bumped = reconcile(r, batch);
    if (bumped.length && onUpdate) onUpdate(bumped);
  };

  const handler = (_event, filename) => {
    if (!filename) return;
    const rel = String(filename).split(path.sep).join("/");
    if (rel.split("/").some((seg) => IGNORE.has(seg))) return;
    pending.add(rel);
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, debounceMs);
  };

  // fs.watch recursive is supported on macOS and Windows; on Linux it is not,
  // so we fall back to watching top-level source dirs individually.
  const watchers = [];
  try {
    watchers.push(fs.watch(r, { recursive: true }, handler));
  } catch {
    for (const entry of fs.readdirSync(r, { withFileTypes: true })) {
      if (entry.isDirectory() && !IGNORE.has(entry.name)) {
        try { watchers.push(fs.watch(path.join(r, entry.name), { recursive: true }, handler)); } catch { /* ignore */ }
      }
    }
  }

  const close = () => {
    if (timer) clearTimeout(timer);
    for (const w of watchers) { try { w.close(); } catch { /* ignore */ } }
  };
  if (signal) signal.addEventListener("abort", close, { once: true });
  return { close };
}
