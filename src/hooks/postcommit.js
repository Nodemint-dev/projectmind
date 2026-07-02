#!/usr/bin/env node
// Deterministic git post-commit updater. Costs zero LLM tokens — pure local
// computation. For each node, if a file changed in this commit matches one of
// the node's `files` globs, bump its freshness (status + lastTouched).
//
// Hard rule: never fail the commit. Everything is wrapped; we always exit 0.
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import path from "node:path";
import picomatch from "picomatch";
import { root, loadScope, save } from "../core/index.js";

const today = () => new Date().toISOString().slice(0, 10);

export function changedFilesFromGit(r) {
  try {
    // --root makes the very first (parentless) commit list its files too.
    const out = execSync("git diff-tree --root --no-commit-id --name-only -r HEAD", {
      cwd: r,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

// Pure: given a map and a list of changed (repo-relative) paths, return the set
// of node ids whose file globs match at least one changed path.
export function matchNodes(map, changedFiles) {
  const matched = new Set();
  for (const [id, node] of Object.entries(map.nodes || {})) {
    const globs = node.files || [];
    if (!globs.length) continue;
    const isMatch = picomatch(globs, { dot: true });
    if (changedFiles.some((f) => isMatch(f))) matched.add(id);
  }
  return matched;
}

// Pure: apply freshness bumps. deprecated nodes keep their status.
export function applyFreshness(map, matchedIds, date = today()) {
  for (const id of matchedIds) {
    const n = map.nodes[id];
    if (!n) continue;
    n.lastTouched = date;
    if (n.status !== "deprecated") n.status = "active";
  }
  return map;
}

export function runPostCommit(r = root()) {
  try {
    // Only the committed (repo) map is touched by the hook.
    const mapFile = path.join(r, ".projectmind", "map.json");
    if (!fs.existsSync(mapFile)) return { updated: false, reason: "no map" };
    const changed = changedFilesFromGit(r);
    if (!changed.length) return { updated: false, reason: "no changed files" };
    const map = loadScope("repo", r);
    const matched = matchNodes(map, changed);
    if (!matched.size) return { updated: false, reason: "no node matched" };
    applyFreshness(map, matched);
    save(map, r, "repo");
    return { updated: true, nodes: [...matched] };
  } catch (err) {
    // Never break a commit.
    try { process.stderr.write(`[projectmind] post-commit skipped: ${err.message}\n`); } catch { /* ignore */ }
    return { updated: false, reason: "error" };
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  runPostCommit();
  process.exit(0);
}

export const __postcommitPath = fileURLToPath(import.meta.url);
