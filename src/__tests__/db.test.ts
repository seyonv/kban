import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  existsSync,
  statSync,
  readFileSync,
} from "fs";
import { execSync } from "child_process";
import { join, resolve } from "path";
import {
  createCard,
  resolveCard,
  updateCard,
  moveCard,
  deleteCard,
  listCards,
  addDecision,
  getDecisions,
  addSnapshot,
  getSnapshots,
  addCardFile,
  getCardFiles,
  getCardsByFile,
  addPrompt,
  getPromptHistory,
  getPromptsByCard,
  getPromptById,
  hasCardWithTitle,
  hasPromptForCommit,
  getInProgressCard,
  closeDb,
  getDb,
  setMeta,
  getMeta,
  autoArchive,
} from "../db";

function freshDb(): string {
  const dir = mkdtempSync("/tmp/.kban-db-test-");
  execSync("git init && git commit --allow-empty -m 'init'", {
    cwd: dir,
    stdio: "ignore",
  });
  process.chdir(dir);
  return dir;
}

function cleanup(dir: string) {
  closeDb();
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

// ── Worktree resolution ─────────────────────────

describe("worktree DB resolution", () => {
  test("worktree .git file contains valid gitdir reference", () => {
    const tempDir = mkdtempSync("/tmp/.kban-wt-");
    execSync("git init && git commit --allow-empty -m 'init'", {
      cwd: tempDir,
      stdio: "ignore",
    });

    execSync("git branch wt-branch", { cwd: tempDir, stdio: "ignore" });
    const wtDir = join(tempDir, "my-worktree");
    execSync(`git worktree add ${wtDir} wt-branch`, {
      cwd: tempDir,
      stdio: "ignore",
    });

    const wtGitPath = join(wtDir, ".git");
    expect(existsSync(wtGitPath)).toBe(true);
    expect(statSync(wtGitPath).isFile()).toBe(true);

    const content = readFileSync(wtGitPath, "utf-8").trim();
    expect(content).toMatch(/^gitdir:/);

    const match = content.match(/^gitdir:\s+(.+)/);
    expect(match).not.toBeNull();
    const gitDir = resolve(wtDir, match![1]);
    expect(gitDir).toContain(".git/worktrees/");

    // Resolve up 3 levels → should be main root
    const mainRoot = resolve(gitDir, "../../..");
    // Use realpath to handle macOS /tmp → /private/tmp symlink
    const { realpathSync } = require("fs");
    expect(realpathSync(mainRoot)).toBe(realpathSync(tempDir));

    execSync(`git worktree remove ${wtDir}`, { cwd: tempDir, stdio: "ignore" });
    rmSync(tempDir, { recursive: true, force: true });
  });
});

// ── Card CRUD ───────────────────────────────────

describe("Card CRUD", () => {
  let tempDir: string;
  beforeEach(() => {
    tempDir = freshDb();
  });
  afterEach(() => cleanup(tempDir));

  test("createCard returns a card with all fields", () => {
    const card = createCard("Test card", {
      type: "feature",
      priority: 2,
      column: "sprint",
    });
    expect(card.id).toBeGreaterThan(0);
    expect(card.short_id).toMatch(/^KB-\d+$/);
    expect(card.title).toBe("Test card");
    expect(card.type).toBe("feature");
    expect(card.priority).toBe(2);
    expect(card.column).toBe("sprint");
    expect(card.created_at).toBeTruthy();
    expect(card.updated_at).toBeTruthy();
    expect(card.archived).toBe(0);
  });

  test("createCard uses defaults", () => {
    const card = createCard("Default card");
    expect(card.column).toBe("backlog");
    expect(card.priority).toBe(3);
    expect(card.type).toBe("feature");
  });

  test("resolveCard by short_id", () => {
    const card = createCard("Resolve test");
    const found = resolveCard(card.short_id);
    expect(found).not.toBeNull();
    expect(found!.title).toBe("Resolve test");
  });

  test("resolveCard by numeric id", () => {
    const card = createCard("Numeric resolve");
    const found = resolveCard(String(card.id));
    expect(found).not.toBeNull();
    expect(found!.title).toBe("Numeric resolve");
  });

  test("resolveCard returns null for non-existent", () => {
    expect(resolveCard("KB-9999")).toBeNull();
    expect(resolveCard("9999")).toBeNull();
  });

  test("updateCard changes fields", () => {
    const card = createCard("Original title");
    updateCard(card.id, {
      title: "Updated title",
      description: "New desc",
      priority: 1 as any,
    });
    const updated = resolveCard(card.short_id)!;
    expect(updated.title).toBe("Updated title");
    expect(updated.description).toBe("New desc");
    expect(updated.priority).toBe(1);
  });

  test("moveCard changes column and sets completed_at for done", () => {
    const card = createCard("Move me");
    expect(card.column).toBe("backlog");

    moveCard(card.id, "in_progress");
    let moved = resolveCard(card.short_id)!;
    expect(moved.column).toBe("in_progress");
    expect(moved.completed_at).toBeNull();

    moveCard(card.id, "done");
    moved = resolveCard(card.short_id)!;
    expect(moved.column).toBe("done");
    expect(moved.completed_at).toBeTruthy();
  });

  test("deleteCard removes the card", () => {
    const card = createCard("Delete me");
    expect(resolveCard(card.short_id)).not.toBeNull();
    deleteCard(card.id);
    expect(resolveCard(card.short_id)).toBeNull();
  });

  test("listCards filters by column", () => {
    createCard("Backlog 1", { column: "backlog" });
    createCard("Sprint 1", { column: "sprint" });
    createCard("Sprint 2", { column: "sprint" });

    const sprint = listCards({ column: "sprint" });
    expect(sprint.length).toBe(2);
    expect(sprint.every((c) => c.column === "sprint")).toBe(true);
  });

  test("listCards filters by type", () => {
    createCard("Feature", { type: "feature" });
    createCard("Bug", { type: "bug" });

    const bugs = listCards({ type: "bug" });
    expect(bugs.length).toBe(1);
    expect(bugs[0].type).toBe("bug");
  });

  test("listCards sorts by priority then sort_order", () => {
    createCard("Low", { priority: 4 });
    createCard("High", { priority: 1 });
    createCard("Med", { priority: 3 });

    const all = listCards();
    expect(all[0].title).toBe("High");
    expect(all[1].title).toBe("Med");
    expect(all[2].title).toBe("Low");
  });

  test("listCards excludes archived by default", () => {
    const card = createCard("Archive me");
    updateCard(card.id, { archived: 1 as any });

    expect(listCards().length).toBe(0);
    expect(listCards({ archived: true }).length).toBe(1);
  });
});

// ── Decision Log ────────────────────────────────

describe("Decision Log", () => {
  let tempDir: string;
  beforeEach(() => {
    tempDir = freshDb();
  });
  afterEach(() => cleanup(tempDir));

  test("addDecision and getDecisions", () => {
    const card = createCard("Decide");
    addDecision(card.id, "Chose SQLite", "Portability");
    addDecision(card.id, "Dropped Redis");

    const decisions = getDecisions(card.id);
    expect(decisions.length).toBe(2);
    // Both have same created_at, so order may vary — just check both exist
    const texts = decisions.map((d) => d.decision);
    expect(texts).toContain("Chose SQLite");
    expect(texts).toContain("Dropped Redis");
    const sqlite = decisions.find((d) => d.decision === "Chose SQLite")!;
    expect(sqlite.reasoning).toBe("Portability");
  });

  test("decisions cascade on card delete", () => {
    const card = createCard("Will be deleted");
    addDecision(card.id, "Some decision");
    deleteCard(card.id);
    expect(getDecisions(card.id)).toEqual([]);
  });
});

// ── Context Snapshots ───────────────────────────

describe("Context Snapshots", () => {
  let tempDir: string;
  beforeEach(() => {
    tempDir = freshDb();
  });
  afterEach(() => cleanup(tempDir));

  test("addSnapshot and getSnapshots", () => {
    const card = createCard("Snapshot test");
    addSnapshot(card.id, {
      branch: "main",
      commitHash: "abc1234",
      notes: "Initial",
    });

    const snaps = getSnapshots(card.id);
    expect(snaps.length).toBe(1);
    expect(snaps[0].branch).toBe("main");
    expect(snaps[0].commit_hash).toBe("abc1234");
    expect(snaps[0].notes).toBe("Initial");
  });
});

// ── Card Files ──────────────────────────────────

describe("Card Files", () => {
  let tempDir: string;
  beforeEach(() => {
    tempDir = freshDb();
  });
  afterEach(() => cleanup(tempDir));

  test("addCardFile and getCardFiles", () => {
    const card = createCard("File test");
    addCardFile(card.id, "src/app.ts");
    addCardFile(card.id, "src/utils.ts");

    const files = getCardFiles(card.id);
    expect(files).toContain("src/app.ts");
    expect(files).toContain("src/utils.ts");
  });

  test("addCardFile ignores duplicates", () => {
    const card = createCard("Dup file test");
    addCardFile(card.id, "src/app.ts");
    addCardFile(card.id, "src/app.ts"); // Should not throw
    expect(getCardFiles(card.id).length).toBe(1);
  });

  test("getCardsByFile returns cards linked to a file", () => {
    const c1 = createCard("Card A");
    const c2 = createCard("Card B");
    addCardFile(c1.id, "src/shared.ts");
    addCardFile(c2.id, "src/shared.ts");

    const cards = getCardsByFile("src/shared.ts");
    expect(cards.length).toBe(2);
  });

  test("files cascade on card delete", () => {
    const card = createCard("File cascade");
    addCardFile(card.id, "src/x.ts");
    deleteCard(card.id);
    expect(getCardFiles(card.id)).toEqual([]);
  });
});

// ── Project Meta ────────────────────────────────

describe("Project Meta", () => {
  let tempDir: string;
  beforeEach(() => {
    tempDir = freshDb();
  });
  afterEach(() => cleanup(tempDir));

  test("setMeta and getMeta", () => {
    const db = getDb();
    setMeta(db, "test_key", "test_value");
    expect(getMeta(db, "test_key")).toBe("test_value");
  });

  test("getMeta returns null for missing key", () => {
    const db = getDb();
    expect(getMeta(db, "nonexistent")).toBeNull();
  });

  test("setMeta overwrites existing value", () => {
    const db = getDb();
    setMeta(db, "key", "v1");
    setMeta(db, "key", "v2");
    expect(getMeta(db, "key")).toBe("v2");
  });
});

// ── Auto Archive ────────────────────────────────

describe("autoArchive", () => {
  let tempDir: string;
  beforeEach(() => {
    tempDir = freshDb();
  });
  afterEach(() => cleanup(tempDir));

  test("archives done cards older than 30 days", () => {
    const card = createCard("Old done", { column: "done" });
    // Manually set completed_at to 31 days ago
    const oldDate = new Date(
      Date.now() - 31 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const db = getDb();
    db.query("UPDATE cards SET completed_at = ? WHERE id = ?").run(
      oldDate,
      card.id,
    );

    autoArchive();

    const archived = listCards({ archived: true });
    expect(archived.length).toBe(1);
    expect(archived[0].id).toBe(card.id);
    // Should not appear in normal list
    expect(listCards().length).toBe(0);
  });

  test("does not archive recent done cards", () => {
    const card = createCard("Recent done");
    moveCard(card.id, "done");

    autoArchive();

    expect(listCards().length).toBe(1);
    expect(listCards({ archived: true }).length).toBe(0);
  });
});

// ── Prompt History ──────────────────────────────

describe("Prompt History", () => {
  let tempDir: string;
  beforeEach(() => {
    tempDir = freshDb();
  });
  afterEach(() => cleanup(tempDir));

  test("addPrompt creates entry with all fields", () => {
    const entry = addPrompt("Add dark mode", "Please add a dark mode toggle", {
      source: "manual",
      commitHash: "abc1234",
    });
    expect(entry.id).toBeGreaterThan(0);
    expect(entry.summary).toBe("Add dark mode");
    expect(entry.prompt).toBe("Please add a dark mode toggle");
    expect(entry.source).toBe("manual");
    expect(entry.commit_hash).toBe("abc1234");
    expect(entry.card_id).toBeNull();
    expect(entry.created_at).toBeTruthy();
  });

  test("addPrompt links to card", () => {
    const card = createCard("My card");
    const entry = addPrompt("Fix bug", "Fix the login bug", {
      cardId: card.id,
    });
    expect(entry.card_id).toBe(card.id);
  });

  test("getPromptHistory returns newest first", () => {
    addPrompt("First", "first prompt", {
      createdAt: "2025-01-01T00:00:00Z",
    });
    addPrompt("Second", "second prompt", {
      createdAt: "2025-01-02T00:00:00Z",
    });
    addPrompt("Third", "third prompt", {
      createdAt: "2025-01-03T00:00:00Z",
    });

    const history = getPromptHistory();
    expect(history.length).toBe(3);
    expect(history[0].summary).toBe("Third");
    expect(history[2].summary).toBe("First");
  });

  test("getPromptHistory respects limit", () => {
    for (let i = 0; i < 5; i++) {
      addPrompt(`Prompt ${i}`, `text ${i}`);
    }
    const limited = getPromptHistory(3);
    expect(limited.length).toBe(3);
  });

  test("getPromptsByCard filters correctly", () => {
    const c1 = createCard("Card A");
    const c2 = createCard("Card B");
    addPrompt("For A", "prompt A", { cardId: c1.id });
    addPrompt("For B", "prompt B", { cardId: c2.id });
    addPrompt("Also for A", "prompt A2", { cardId: c1.id });

    const forA = getPromptsByCard(c1.id);
    expect(forA.length).toBe(2);
    expect(forA.every((p) => p.card_id === c1.id)).toBe(true);
  });

  test("getPromptById returns single entry", () => {
    const entry = addPrompt("Test", "test prompt");
    const found = getPromptById(entry.id);
    expect(found).not.toBeNull();
    expect(found!.summary).toBe("Test");
  });

  test("getPromptById returns null for missing", () => {
    expect(getPromptById(9999)).toBeNull();
  });

  test("prompt persists after linked card is deleted (SET NULL)", () => {
    const card = createCard("Will delete");
    const entry = addPrompt("Linked prompt", "text", { cardId: card.id });
    deleteCard(card.id);

    const found = getPromptById(entry.id);
    expect(found).not.toBeNull();
    expect(found!.card_id).toBeNull();
  });
});

// ── Dedup Helpers ───────────────────────────────

describe("Dedup Helpers", () => {
  let tempDir: string;
  beforeEach(() => {
    tempDir = freshDb();
  });
  afterEach(() => cleanup(tempDir));

  test("hasCardWithTitle finds existing cards", () => {
    createCard("Unique title");
    expect(hasCardWithTitle("Unique title")).toBe(true);
    expect(hasCardWithTitle("Nonexistent")).toBe(false);
  });

  test("hasCardWithTitle ignores archived cards", () => {
    const card = createCard("Archived card");
    updateCard(card.id, { archived: 1 as any });
    expect(hasCardWithTitle("Archived card")).toBe(false);
  });

  test("hasPromptForCommit finds existing commits", () => {
    addPrompt("Test", "text", { commitHash: "abc1234" });
    expect(hasPromptForCommit("abc1234")).toBe(true);
    expect(hasPromptForCommit("xyz9999")).toBe(false);
  });

  test("getInProgressCard returns first in-progress card by priority", () => {
    createCard("Low priority", { column: "in_progress", priority: 4 });
    createCard("High priority", { column: "in_progress", priority: 1 });
    const card = getInProgressCard();
    expect(card).not.toBeNull();
    expect(card!.title).toBe("High priority");
  });

  test("getInProgressCard returns null when none in progress", () => {
    createCard("Backlog card", { column: "backlog" });
    expect(getInProgressCard()).toBeNull();
  });
});
