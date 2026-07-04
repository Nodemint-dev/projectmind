// Smoke tests for the CLI as a real subprocess — catches entrypoint-level
// bugs (argv parsing, package.json path resolution) that calling core
// functions directly can't.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "cli", "index.js");
const PKG_VERSION = JSON.parse(
  fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8")
).version;

function run(args) {
  return execFileSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
}

test("--version and -v print the actual installed version, matching package.json", () => {
  assert.equal(run(["--version"]).trim(), `projectmind v${PKG_VERSION}`);
  assert.equal(run(["-v"]).trim(), `projectmind v${PKG_VERSION}`);
});

test("--help and no-args both print usage, and mention the version flag", () => {
  for (const args of [["--help"], []]) {
    const out = run(args);
    assert.match(out, /Usage: projectmind/);
    assert.match(out, /--version/);
  }
});
