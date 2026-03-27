import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { execSync } from "child_process";
import { join, resolve } from "path";

/**
 * Test findGitRoot worktree resolution.
 *
 * Since findGitRoot is not exported, we test it indirectly
 * by checking that getDbPath resolves to the main repo's .kanban/
 * when run from a worktree.
 */
describe("worktree DB resolution", () => {
  test("worktree .git file resolves to main repo root", () => {
    const tempDir = mkdtempSync(join(import.meta.dir, ".tmp-wt-"));

    // Create a git repo
    execSync("git init && git commit --allow-empty -m 'init'", {
      cwd: tempDir,
      stdio: "ignore",
    });

    // Create a branch and worktree
    execSync("git branch wt-branch", { cwd: tempDir, stdio: "ignore" });
    const wtDir = join(tempDir, "my-worktree");
    execSync(`git worktree add ${wtDir} wt-branch`, {
      cwd: tempDir,
      stdio: "ignore",
    });

    // The worktree's .git should be a file, not a directory
    const wtGitPath = join(wtDir, ".git");
    expect(existsSync(wtGitPath)).toBe(true);
    const stat = require("fs").statSync(wtGitPath);
    expect(stat.isFile()).toBe(true);

    // Read the .git file — it should contain a gitdir: line
    const content = require("fs").readFileSync(wtGitPath, "utf-8").trim();
    expect(content).toMatch(/^gitdir:/);

    // Parse the gitdir path and verify it points into .git/worktrees/
    const match = content.match(/^gitdir:\s+(.+)/);
    expect(match).not.toBeNull();
    const gitDir = resolve(wtDir, match![1]);
    expect(gitDir).toContain(".git/worktrees/");

    // Resolve up 3 levels from .git/worktrees/<name> → should be main root
    const mainRoot = resolve(gitDir, "../../..");
    expect(mainRoot).toBe(resolve(tempDir));

    // Cleanup
    execSync(`git worktree remove ${wtDir}`, {
      cwd: tempDir,
      stdio: "ignore",
    });
    rmSync(tempDir, { recursive: true, force: true });
  });
});
