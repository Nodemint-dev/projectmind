// Installs the post-commit hook idempotently, preserving any existing hook by
// chaining rather than overwriting.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SENTINEL = "# >>> projectmind post-commit hook >>>";
const SENTINEL_END = "# <<< projectmind post-commit hook <<<";

const postcommitScript = fileURLToPath(new URL("./postcommit.js", import.meta.url));

function hookBlock() {
  // `|| true` belt-and-suspenders: the script already exits 0, but never let a
  // node crash fail the commit.
  return [
    SENTINEL,
    `node ${JSON.stringify(postcommitScript)} || true`,
    SENTINEL_END,
  ].join("\n");
}

export function installHook(r) {
  const gitDir = path.join(r, ".git");
  if (!fs.existsSync(gitDir)) {
    throw new Error("not a git repository (no .git directory found)");
  }
  const hooksDir = path.join(gitDir, "hooks");
  fs.mkdirSync(hooksDir, { recursive: true });
  const hookFile = path.join(hooksDir, "post-commit");

  let existing = "";
  try { existing = fs.readFileSync(hookFile, "utf8"); } catch { /* none */ }

  if (existing.includes(SENTINEL)) {
    return { installed: false, alreadyInstalled: true, path: hookFile };
  }

  let content;
  if (!existing.trim()) {
    content = `#!/bin/sh\n${hookBlock()}\n`;
  } else {
    // Append our block, preserving whatever was there (and its shebang).
    const sep = existing.endsWith("\n") ? "" : "\n";
    content = `${existing}${sep}\n${hookBlock()}\n`;
  }

  fs.writeFileSync(hookFile, content);
  fs.chmodSync(hookFile, 0o755);
  return { installed: true, alreadyInstalled: false, path: hookFile };
}
