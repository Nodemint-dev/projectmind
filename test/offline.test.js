// The offline guarantee, enforced by CI — not just claimed in the README.
// No file in src/ may import or call any network API. If this test passes,
// projectmind cannot phone home.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../src", import.meta.url));

const NETWORK_PATTERNS = [
  /from\s+["'](node:)?https?["']/,          // import http/https
  /require\(\s*["'](node:)?https?["']\s*\)/,
  /from\s+["'](node:)?(net|tls|dgram|dns)["']/,
  /require\(\s*["'](node:)?(net|tls|dgram|dns)["']\s*\)/,
  /\bfetch\s*\(/,                            // global fetch
  /XMLHttpRequest/,
  /\bWebSocket\b/,
  /from\s+["'](axios|node-fetch|got|undici|request)["']/,
];

function walk(dir, files = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, files);
    else if (e.name.endsWith(".js")) files.push(p);
  }
  return files;
}

test("offline guarantee: no network APIs anywhere in src/", () => {
  const files = walk(SRC);
  assert.ok(files.length >= 6, "expected to scan the real source tree");
  const violations = [];
  for (const f of files) {
    const content = fs.readFileSync(f, "utf8");
    for (const pattern of NETWORK_PATTERNS) {
      if (pattern.test(content)) violations.push(`${path.relative(SRC, f)}: matches ${pattern}`);
    }
  }
  assert.deepEqual(violations, [], `network API usage found:\n${violations.join("\n")}`);
});
