import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { execSync } from "child_process";
import { join } from "path";
import { analyzeProject, createCardsFromAnalysis } from "../sync";
import { listCards, closeDb, getDb } from "../db";

function createTempGitRepo(): string {
  const dir = mkdtempSync(join(import.meta.dir, ".tmp-test-"));
  execSync("git init && git commit --allow-empty -m 'Initial commit'", {
    cwd: dir,
    stdio: "ignore",
  });
  return dir;
}

function cleanup(dir: string) {
  closeDb();
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

describe("analyzeProject", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempGitRepo();
  });

  afterEach(() => cleanup(tempDir));

  test("detects git repo with hasGit=true", () => {
    const analysis = analyzeProject(tempDir);
    expect(analysis.hasGit).toBe(true);
    expect(analysis.totalCommits).toBe("1");
    expect(analysis.projectName).toBeTruthy();
  });

  test("reads package.json and detects tech stack", () => {
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({
        name: "test-proj",
        version: "1.0.0",
        dependencies: { react: "^19.0.0" },
        devDependencies: { typescript: "^5.0.0" },
      }),
    );
    const analysis = analyzeProject(tempDir);
    expect(analysis.pkg.name).toBe("test-proj");
    expect(analysis.techStack).toContain("React");
    expect(analysis.techStack).toContain("TypeScript");
  });

  test("handles no-git directory gracefully", () => {
    // Use /tmp to avoid being inside any git repo
    const noGitDir = mkdtempSync("/tmp/.kban-nogit-");
    const analysis = analyzeProject(noGitDir);
    expect(analysis.hasGit).toBe(false);
    expect(analysis.gitLog).toBe("");
    expect(analysis.totalCommits).toBe("0");
    expect(analysis.worktrees).toEqual([]);
    rmSync(noGitDir, { recursive: true, force: true });
  });

  test("detects worktrees", () => {
    // Create a worktree
    execSync("git branch test-branch", { cwd: tempDir, stdio: "ignore" });
    const wtDir = join(tempDir, "wt-test");
    execSync(`git worktree add ${wtDir} test-branch`, {
      cwd: tempDir,
      stdio: "ignore",
    });

    const analysis = analyzeProject(tempDir);
    expect(analysis.worktrees.length).toBe(1);
    expect(analysis.worktrees[0].branch).toBe("test-branch");

    // Cleanup worktree
    execSync(`git worktree remove ${wtDir}`, { cwd: tempDir, stdio: "ignore" });
  });
});

describe("createCardsFromAnalysis", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempGitRepo();
    process.chdir(tempDir);
  });

  afterEach(() => cleanup(tempDir));

  test("creates cards and returns count", () => {
    const analysis = analyzeProject(tempDir);
    const cards: string[] = [];
    const count = createCardsFromAnalysis(analysis, {
      prefix: "TEST",
      onCard: (title) => cards.push(title),
    });
    expect(count).toBeGreaterThan(0);
    expect(cards.length).toBe(count);
    // Should include project overview
    expect(cards.some((t) => t.includes("Project Overview"))).toBe(true);
  });

  test("returns 0 when board already has cards (dedup)", () => {
    const analysis = analyzeProject(tempDir);
    // First sync
    createCardsFromAnalysis(analysis, { prefix: "TEST" });
    const firstCount = listCards().length;
    expect(firstCount).toBeGreaterThan(0);

    // Second sync — should return 0
    const secondCount = createCardsFromAnalysis(analysis, { prefix: "TEST" });
    expect(secondCount).toBe(0);
    // Card count unchanged
    expect(listCards().length).toBe(firstCount);
  });

  test("fires onCard callback for each card", () => {
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ name: "cb-test", dependencies: {} }),
    );
    execSync("git add -A && git commit -m 'Add package.json'", {
      cwd: tempDir,
      stdio: "ignore",
    });

    const analysis = analyzeProject(tempDir);
    const received: { title: string; column: string; shortId: string }[] = [];
    createCardsFromAnalysis(analysis, {
      prefix: "CB",
      onCard: (title, column, shortId) =>
        received.push({ title, column, shortId }),
    });

    expect(received.length).toBeGreaterThan(0);
    // All shortIds should start with prefix
    for (const r of received) {
      expect(r.shortId).toMatch(/^CB-\d+$/);
    }
  });
});
