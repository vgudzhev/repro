import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export interface WorktreeInfo {
  path: string;
  commit: string;
}

export function createWorktree(repoDir: string, commit?: string): WorktreeInfo {
  const prefix = join(tmpdir(), "repro-worktree-");
  const worktreePath = mkdtempSync(prefix);

  const targetCommit =
    commit ??
    execSync("git rev-parse HEAD", { cwd: repoDir, encoding: "utf-8" }).trim();

  execSync(`git worktree add --detach "${worktreePath}" ${targetCommit}`, {
    cwd: repoDir,
    encoding: "utf-8",
    stdio: "pipe",
  });

  return { path: worktreePath, commit: targetCommit };
}

export function removeWorktree(
  repoDir: string,
  worktreePath: string,
): void {
  try {
    execSync(`git worktree remove --force "${worktreePath}"`, {
      cwd: repoDir,
      encoding: "utf-8",
      stdio: "pipe",
    });
  } catch {
    try {
      rmSync(worktreePath, { recursive: true, force: true });
      execSync("git worktree prune", {
        cwd: repoDir,
        encoding: "utf-8",
        stdio: "pipe",
      });
    } catch {
      // best-effort cleanup
    }
  }
}
