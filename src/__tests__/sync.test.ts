import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { execSync } from "child_process";
import { join } from "path";
import {
  analyzeProject,
  createCardsFromAnalysis,
  incrementalSync,
} from "../sync";
import { listCards, getPromptHistory, closeDb, getDb } from "../db";

function createTempGitRepo(): string {
  const dir = mkdtempSync("/tmp/.kban-test-");
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

// ── analyzeProject ──────────────────────────────

describe("analyzeProject", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempGitRepo();
  });

  afterEach(() => cleanup(tempDir));

  test("detects git repo with hasGit=true", () => {
    const a = analyzeProject(tempDir);
    expect(a.hasGit).toBe(true);
    expect(a.totalCommits).toBe("1");
    expect(a.projectName).toBeTruthy();
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
    const a = analyzeProject(tempDir);
    expect(a.pkg.name).toBe("test-proj");
    expect(a.techStack).toContain("React");
    expect(a.techStack).toContain("TypeScript");
  });

  test("detects multiple frameworks in tech stack", () => {
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({
        dependencies: { next: "^14", react: "^19", prisma: "^5" },
        devDependencies: { vitest: "^2", tailwindcss: "^4" },
      }),
    );
    const a = analyzeProject(tempDir);
    expect(a.techStack).toContain("Next.js");
    expect(a.techStack).toContain("React");
    expect(a.techStack).toContain("Prisma");
    expect(a.techStack).toContain("Vitest");
    expect(a.techStack).toContain("Tailwind");
  });

  test("detects bun lock file", () => {
    writeFileSync(join(tempDir, "package.json"), "{}");
    writeFileSync(join(tempDir, "bun.lock"), "");
    const a = analyzeProject(tempDir);
    expect(a.techStack).toContain("Bun");
  });

  test("handles no-git directory gracefully", () => {
    const noGitDir = mkdtempSync("/tmp/.kban-nogit-");
    const a = analyzeProject(noGitDir);
    expect(a.hasGit).toBe(false);
    expect(a.gitLog).toBe("");
    expect(a.totalCommits).toBe("0");
    expect(a.worktrees).toEqual([]);
    expect(a.todoComments).toEqual([]);
    rmSync(noGitDir, { recursive: true, force: true });
  });

  test("reads CLAUDE.md and DESIGN.md", () => {
    writeFileSync(
      join(tempDir, "CLAUDE.md"),
      "# Project Instructions\nUse TypeScript.",
    );
    writeFileSync(
      join(tempDir, "DESIGN.md"),
      "# Design System\nColors: blue, green.",
    );
    const a = analyzeProject(tempDir);
    expect(a.claudeMd).toContain("Project Instructions");
    expect(a.designMd).toContain("Design System");
  });

  test("reads tasks/todo.md", () => {
    mkdirSync(join(tempDir, "tasks"));
    writeFileSync(
      join(tempDir, "tasks/todo.md"),
      "- [x] Done task\n- [ ] Pending task\n- [ ] Another pending",
    );
    const a = analyzeProject(tempDir);
    expect(a.todoMd).toContain("Pending task");
  });

  test("finds test files", () => {
    mkdirSync(join(tempDir, "src/__tests__"), { recursive: true });
    writeFileSync(
      join(tempDir, "src/__tests__/foo.test.ts"),
      "test('x', () => {})",
    );
    writeFileSync(
      join(tempDir, "src/__tests__/bar.spec.ts"),
      "test('y', () => {})",
    );
    const a = analyzeProject(tempDir);
    expect(a.testFiles.length).toBe(2);
  });

  test("finds source files excluding tests and node_modules", () => {
    mkdirSync(join(tempDir, "src"), { recursive: true });
    writeFileSync(join(tempDir, "src/app.ts"), "console.log('app')");
    writeFileSync(join(tempDir, "src/app.test.ts"), "test('x', () => {})");
    const a = analyzeProject(tempDir);
    expect(
      a.srcFiles.some((f) => f.includes("app.ts") && !f.includes("test")),
    ).toBe(true);
    expect(a.srcFiles.some((f) => f.includes("app.test.ts"))).toBe(false);
  });

  test("parses git log for commit history", () => {
    execSync("git commit --allow-empty -m 'Add feature X'", {
      cwd: tempDir,
      stdio: "ignore",
    });
    execSync("git commit --allow-empty -m 'Fix bug in Y'", {
      cwd: tempDir,
      stdio: "ignore",
    });
    const a = analyzeProject(tempDir);
    expect(a.totalCommits).toBe("3");
    expect(a.gitLog).toContain("Add feature X");
    expect(a.gitLog).toContain("Fix bug in Y");
    expect(a.lastCommitMsg).toContain("Fix bug in Y");
  });

  test("detects current branch", () => {
    const a = analyzeProject(tempDir);
    expect(a.currentBranch).toBe("main");
  });

  test("detects worktrees", () => {
    execSync("git branch test-branch", { cwd: tempDir, stdio: "ignore" });
    // Put worktree outside the main repo to avoid nesting issues
    const wtDir = mkdtempSync("/tmp/.kban-wt-target-");
    rmSync(wtDir, { recursive: true }); // git worktree add needs non-existent path
    execSync(`git worktree add ${wtDir} test-branch`, {
      cwd: tempDir,
      stdio: "ignore",
    });

    const a = analyzeProject(tempDir);
    // Should find the worktree (excludes main repo itself)
    expect(a.worktrees.length).toBeGreaterThanOrEqual(1);
    expect(a.worktrees.some((w) => w.branch === "test-branch")).toBe(true);

    execSync(`git worktree remove ${wtDir}`, { cwd: tempDir, stdio: "ignore" });
  });

  test("scans TODO/FIXME comments from source", () => {
    mkdirSync(join(tempDir, "src"), { recursive: true });
    writeFileSync(
      join(tempDir, "src/main.ts"),
      "// TODO: implement caching\n// FIXME: memory leak in handler\nconsole.log('ok');",
    );
    execSync("git add -A && git commit -m 'add src'", {
      cwd: tempDir,
      stdio: "ignore",
    });
    const a = analyzeProject(tempDir);
    expect(a.todoComments.length).toBeGreaterThanOrEqual(1);
    const todo = a.todoComments.find((c) =>
      c.text.includes("implement caching"),
    );
    expect(todo).toBeTruthy();
    expect(todo!.isBug).toBe(false);
    const fixme = a.todoComments.find((c) => c.text.includes("memory leak"));
    expect(fixme).toBeTruthy();
    expect(fixme!.isBug).toBe(true);
  });

  test("returns empty pkg for missing package.json", () => {
    const a = analyzeProject(tempDir);
    expect(a.pkg).toEqual({});
    expect(a.techStack).toEqual([]);
  });
});

// ── createCardsFromAnalysis ─────────────────────

describe("createCardsFromAnalysis", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempGitRepo();
    process.chdir(tempDir);
  });

  afterEach(() => cleanup(tempDir));

  test("creates cards and returns count", () => {
    const a = analyzeProject(tempDir);
    const cards: string[] = [];
    const count = createCardsFromAnalysis(a, {
      prefix: "TEST",
      onCard: (title) => cards.push(title),
    });
    expect(count).toBeGreaterThan(0);
    expect(cards.length).toBe(count);
    expect(cards.some((t) => t.includes("Project Overview"))).toBe(true);
  });

  test("returns 0 when board already has cards (dedup guard)", () => {
    const a = analyzeProject(tempDir);
    createCardsFromAnalysis(a, { prefix: "TEST" });
    const firstCount = listCards().length;
    expect(firstCount).toBeGreaterThan(0);

    const secondCount = createCardsFromAnalysis(a, { prefix: "TEST" });
    expect(secondCount).toBe(0);
    expect(listCards().length).toBe(firstCount);
  });

  test("uses custom prefix for card short_ids", () => {
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ name: "foo" }),
    );
    execSync("git add -A && git commit -m 'Add pkg'", {
      cwd: tempDir,
      stdio: "ignore",
    });

    const a = analyzeProject(tempDir);
    const ids: string[] = [];
    createCardsFromAnalysis(a, {
      prefix: "MYAPP",
      onCard: (_t, _c, shortId) => ids.push(shortId),
    });

    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(id).toMatch(/^MYAPP-\d+$/);
    }
  });

  test("creates done cards from git history", () => {
    execSync("git commit --allow-empty -m 'Add user authentication'", {
      cwd: tempDir,
      stdio: "ignore",
    });
    const a = analyzeProject(tempDir);
    const received: { title: string; column: string }[] = [];
    createCardsFromAnalysis(a, {
      prefix: "T",
      onCard: (title, column) => received.push({ title, column }),
    });

    const authCard = received.find((r) =>
      r.title.includes("user authentication"),
    );
    expect(authCard).toBeTruthy();
    expect(authCard!.column).toBe("done");
  });

  test("creates bug cards from fix commits", () => {
    execSync("git commit --allow-empty -m 'Fix crash on empty input'", {
      cwd: tempDir,
      stdio: "ignore",
    });
    const a = analyzeProject(tempDir);
    const received: { title: string; column: string }[] = [];
    createCardsFromAnalysis(a, {
      prefix: "T",
      onCard: (title, column) => received.push({ title, column }),
    });

    const fixCard = received.find((r) => r.title.includes("crash on empty"));
    expect(fixCard).toBeTruthy();
    expect(fixCard!.column).toBe("done");
  });

  test("creates backlog cards from TODO comments", () => {
    mkdirSync(join(tempDir, "src"), { recursive: true });
    writeFileSync(
      join(tempDir, "src/app.ts"),
      "// TODO: add pagination support",
    );
    execSync("git add -A && git commit -m 'add app'", {
      cwd: tempDir,
      stdio: "ignore",
    });

    const a = analyzeProject(tempDir);
    const received: { title: string; column: string }[] = [];
    createCardsFromAnalysis(a, {
      prefix: "T",
      onCard: (title, column) => received.push({ title, column }),
    });

    const todoCard = received.find((r) => r.title.includes("pagination"));
    expect(todoCard).toBeTruthy();
    expect(todoCard!.column).toBe("backlog");
  });

  test("creates backlog cards from skipped tests", () => {
    mkdirSync(join(tempDir, "src/__tests__"), { recursive: true });
    writeFileSync(
      join(tempDir, "src/__tests__/a.test.ts"),
      `import { test } from 'bun:test';\ntest.todo("should handle edge case");\n`,
    );
    const a = analyzeProject(tempDir);
    const received: { title: string; column: string }[] = [];
    createCardsFromAnalysis(a, {
      prefix: "T",
      onCard: (title, column) => received.push({ title, column }),
    });

    const skipCard = received.find((r) => r.title.includes("handle edge case"));
    expect(skipCard).toBeTruthy();
    expect(skipCard!.column).toBe("backlog");
  });

  test("creates sprint cards from tasks/todo.md", () => {
    mkdirSync(join(tempDir, "tasks"));
    writeFileSync(
      join(tempDir, "tasks/todo.md"),
      "- [x] Already done\n- [ ] Ship dark mode\n- [ ] Add export feature",
    );
    const a = analyzeProject(tempDir);
    const received: { title: string; column: string }[] = [];
    createCardsFromAnalysis(a, {
      prefix: "T",
      onCard: (title, column) => received.push({ title, column }),
    });

    const darkMode = received.find((r) => r.title.includes("dark mode"));
    expect(darkMode).toBeTruthy();
    expect(darkMode!.column).toBe("sprint");
    // Done items should NOT appear as sprint cards
    const doneItem = received.find(
      (r) => r.title === "Already done" && r.column === "sprint",
    );
    expect(doneItem).toBeUndefined();
  });

  test("creates design system card when DESIGN.md exists", () => {
    writeFileSync(
      join(tempDir, "DESIGN.md"),
      "# Colors\nprimary: blue\n# Typography\nbody: sans-serif",
    );
    const a = analyzeProject(tempDir);
    const received: { title: string; column: string }[] = [];
    createCardsFromAnalysis(a, {
      prefix: "T",
      onCard: (title, column) => received.push({ title, column }),
    });

    const designCard = received.find((r) => r.title.includes("Design System"));
    expect(designCard).toBeTruthy();
    expect(designCard!.column).toBe("done");
  });

  test("creates last session context card", () => {
    const a = analyzeProject(tempDir);
    const received: { title: string; column: string }[] = [];
    createCardsFromAnalysis(a, {
      prefix: "T",
      onCard: (title, column) => received.push({ title, column }),
    });

    const sessionCard = received.find((r) =>
      r.title.includes("Last Session Context"),
    );
    expect(sessionCard).toBeTruthy();
    expect(sessionCard!.column).toBe("review");
  });

  test("fires onCard callback with correct arguments", () => {
    const a = analyzeProject(tempDir);
    const received: { title: string; column: string; shortId: string }[] = [];
    createCardsFromAnalysis(a, {
      prefix: "CB",
      onCard: (title, column, shortId) =>
        received.push({ title, column, shortId }),
    });

    expect(received.length).toBeGreaterThan(0);
    for (const r of received) {
      expect(r.title).toBeTruthy();
      expect(r.column).toBeTruthy();
      expect(r.shortId).toMatch(/^CB-\d+$/);
    }
  });

  test("populates prompt_history from git commits", () => {
    execSync("git commit --allow-empty -m 'Add user auth'", {
      cwd: tempDir,
      stdio: "ignore",
    });
    execSync("git commit --allow-empty -m 'Fix login bug'", {
      cwd: tempDir,
      stdio: "ignore",
    });

    const a = analyzeProject(tempDir);
    createCardsFromAnalysis(a, { prefix: "T" });

    const prompts = getPromptHistory();
    // Should have entries from all commits (including initial)
    expect(prompts.length).toBe(3);
    expect(prompts.some((p) => p.summary.includes("user auth"))).toBe(true);
    expect(prompts.some((p) => p.summary.includes("login bug"))).toBe(true);
    // All should be git_commit source
    expect(prompts.every((p) => p.source === "git_commit")).toBe(true);
    // All should have commit hashes
    expect(prompts.every((p) => p.commit_hash)).toBe(true);
  });
});

// ── incrementalSync ─────────────────────────────

describe("incrementalSync", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempGitRepo();
    process.chdir(tempDir);
  });

  afterEach(() => cleanup(tempDir));

  test("adds new commits without duplicating existing ones", () => {
    // Initial sync
    const a = analyzeProject(tempDir);
    createCardsFromAnalysis(a, { prefix: "T" });
    const initialPrompts = getPromptHistory().length;

    // Add a new commit
    execSync("git commit --allow-empty -m 'Add new feature'", {
      cwd: tempDir,
      stdio: "ignore",
    });

    // Incremental sync
    const { newPrompts } = incrementalSync(tempDir);
    expect(newPrompts).toBe(1);

    // Total should be initial + 1
    expect(getPromptHistory().length).toBe(initialPrompts + 1);
    expect(
      getPromptHistory().some((p) => p.summary.includes("new feature")),
    ).toBe(true);
  });

  test("does not duplicate prompts on re-sync", () => {
    const a = analyzeProject(tempDir);
    createCardsFromAnalysis(a, { prefix: "T" });
    const firstCount = getPromptHistory().length;

    // Run incremental sync twice — should add nothing
    const r1 = incrementalSync(tempDir);
    const r2 = incrementalSync(tempDir);
    expect(r1.newPrompts).toBe(0);
    expect(r2.newPrompts).toBe(0);
    expect(getPromptHistory().length).toBe(firstCount);
  });

  test("adds new TODO comments as cards", () => {
    const a = analyzeProject(tempDir);
    createCardsFromAnalysis(a, { prefix: "T" });
    const initialCards = listCards().length;

    // Add a TODO comment
    mkdirSync(join(tempDir, "src"), { recursive: true });
    writeFileSync(
      join(tempDir, "src/new.ts"),
      "// TODO: implement caching layer",
    );
    execSync("git add -A && git commit -m 'add new file'", {
      cwd: tempDir,
      stdio: "ignore",
    });

    const { newCards } = incrementalSync(tempDir);
    expect(newCards).toBeGreaterThanOrEqual(1);
    expect(listCards().length).toBeGreaterThan(initialCards);
  });
});
