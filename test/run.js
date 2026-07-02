// Cross-platform test entry. `node --test test/*.test.js` depends on shell
// glob expansion, which PowerShell doesn't do — so we enumerate the test files
// ourselves and hand Node an explicit list. Works identically on all OSes.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const files = fs
  .readdirSync(testDir)
  .filter((f) => f.endsWith(".test.js"))
  .sort()
  .map((f) => path.join(testDir, f));

const res = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
process.exit(res.status ?? 1);
