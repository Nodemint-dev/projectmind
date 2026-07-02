import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Create an isolated temp project root. Tests never touch the real repo.
export function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "projectmind-test-"));
}

export function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}
