// Smoke tests for the CLI as a real subprocess — catches entrypoint-level
// bugs (argv parsing, package.json path resolution) that calling core
// functions directly can't.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
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

test("one-command init: scaffold + seed + AGENTS.md wiring + gitignore + reload notice, in a single run", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-cli-init-"));
  try {
    fs.mkdirSync(path.join(dir, "src", "api"), { recursive: true });
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "one-cmd", description: "one-command init test" }));
    fs.writeFileSync(path.join(dir, "src", "api", "a.js"), "export const a = 1;\n");
    fs.writeFileSync(path.join(dir, "src", "api", "b.js"), "export const b = 2;\n");

    const out = execFileSync(process.execPath, [CLI, "init"], { encoding: "utf8", cwd: dir });

    // everything wired from the single command
    assert.ok(fs.existsSync(path.join(dir, ".projectmind", "map.json")), "map scaffolded");
    assert.match(out, /Seeded/, "seeding ran without a flag");
    // AGENTS.md is always wired regardless of which agents the machine has,
    // so it's the deterministic thing to assert in CI
    const agentsMd = fs.readFileSync(path.join(dir, "AGENTS.md"), "utf8");
    assert.match(agentsMd, /projectmind:digest:begin/, "digest embedded at init time");
    assert.match(agentsMd, /one-cmd/, "embedded digest carries real project content");
    const gi = fs.readFileSync(path.join(dir, ".gitignore"), "utf8");
    assert.ok(gi.split(/\r?\n/).some((l) => l.trim() === ".projectmind/"), "map gitignored (local-first)");
    // the user must be told about the one manual step we can't do for them
    assert.match(out, /[Rr]estart your AI agent/, "reload instruction present");
    assert.match(out, /Reload Window/, "VS Code extension reload instruction present");
    // no git repo here — hook skip must be graceful, not an error
    assert.match(out, /Skipped git hook/, "hook skip is explained, not fatal");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("init --bare only scaffolds (old behavior preserved)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-cli-bare-"));
  try {
    execFileSync(process.execPath, [CLI, "init", "--bare"], { encoding: "utf8", cwd: dir });
    assert.ok(fs.existsSync(path.join(dir, ".projectmind", "map.json")));
    assert.ok(!fs.existsSync(path.join(dir, "AGENTS.md")), "bare init must not create rules files");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
