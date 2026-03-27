#!/usr/bin/env bun
/**
 * kanban sync — Analyze an existing project and populate its kanban board.
 *
 * Exports:
 *   analyzeProject(path)          — pure data gathering, no side effects
 *   createCardsFromAnalysis(...)  — creates cards in DB, fires onCard callback
 *
 * Usage:
 *   bun run src/sync.ts /path/to/project
 *   bun run src/sync.ts  (uses cwd)
 */

import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { resolve, relative, basename } from "path";
import {
  createCard,
  addDecision,
  addCardFile,
  addSnapshot,
  addPrompt,
  listCards,
  hasCardWithTitle,
  hasPromptForCommit,
  getDb,
  setMeta,
  closeDb,
} from "./db";
import type { Column, CardType, Priority } from "./models/card";

// ── Types ───────────────────────────────────────

export interface TodoComment {
  file: string;
  line: number;
  text: string;
  isBug: boolean;
}

export interface Worktree {
  path: string;
  branch: string;
  commit: string;
}

export interface ProjectAnalysis {
  projectName: string;
  projectPath: string;
  hasGit: boolean;
  gitLog: string;
  currentBranch: string;
  totalCommits: string;
  lastCommitMsg: string;
  lastCommitDate: string;
  gitBranches: string;
  pkg: any;
  techStack: string[];
  srcFiles: string[];
  testFiles: string[];
  claudeMd: string;
  designMd: string;
  readmeMd: string;
  todoMd: string;
  productRoadmap: string;
  lessonsMd: string;
  todoComments: TodoComment[];
  worktrees: Worktree[];
}

// ── Helpers (pure, no side effects) ─────────────

function run(cmd: string, cwd: string): string {
  try {
    return execSync(cmd, { cwd, encoding: "utf-8", timeout: 10000 }).trim();
  } catch {
    return "";
  }
}

function readFile(projectPath: string, relPath: string): string {
  const full = resolve(projectPath, relPath);
  if (!existsSync(full)) return "";
  try {
    return readFileSync(full, "utf-8");
  } catch {
    return "";
  }
}

function findFiles(projectPath: string, pattern: string): string[] {
  const result = run(
    `find ${projectPath} -name "${pattern}" -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/dist/*" -not -path "*/build/*" 2>/dev/null`,
    projectPath,
  );
  return result
    ? result
        .split("\n")
        .filter(Boolean)
        .map((f) => relative(projectPath, f))
    : [];
}

function parseTodoItems(content: string): { text: string; done: boolean }[] {
  const items: { text: string; done: boolean }[] = [];
  for (const line of content.split("\n")) {
    const m = line.match(/^[-*]\s*\[([ xX✓✅])\]\s*(.*)/);
    if (m) {
      const done = m[1] !== " ";
      const text = m[2].trim();
      if (text.length > 3) items.push({ text, done });
    }
  }
  return items;
}

function detectTechStack(pkg: any, projectPath: string): string[] {
  const stack: string[] = [];
  const check = (
    deps: Record<string, string> | undefined,
    names: [string, string][],
  ) => {
    if (!deps) return;
    const keys = Object.keys(deps);
    for (const [pattern, label] of names) {
      if (keys.some((k) => k.includes(pattern))) stack.push(label);
    }
  };

  check(pkg.dependencies, [
    ["react", "React"],
    ["next", "Next.js"],
    ["vue", "Vue"],
    ["svelte", "Svelte"],
    ["electron", "Electron"],
    ["express", "Express"],
    ["hono", "Hono"],
    ["capacitor", "Capacitor"],
    ["prisma", "Prisma"],
    ["drizzle", "Drizzle"],
  ]);
  check(pkg.devDependencies, [
    ["vitest", "Vitest"],
    ["jest", "Jest"],
    ["typescript", "TypeScript"],
    ["tailwind", "Tailwind"],
    ["electron", "Electron"],
  ]);

  if (
    existsSync(resolve(projectPath, "bun.lock")) ||
    existsSync(resolve(projectPath, "bun.lockb"))
  )
    stack.push("Bun");
  else if (existsSync(resolve(projectPath, "yarn.lock"))) stack.push("Yarn");
  else if (existsSync(resolve(projectPath, "pnpm-lock.yaml")))
    stack.push("pnpm");

  return stack;
}

function detectWorktrees(projectPath: string): Worktree[] {
  const output = run("git worktree list --porcelain", projectPath);
  if (!output) return [];
  const worktrees: Worktree[] = [];
  const blocks = output.split("\n\n").filter(Boolean);
  for (const block of blocks) {
    const lines = block.split("\n");
    const pathLine = lines.find((l) => l.startsWith("worktree "));
    const branchLine = lines.find((l) => l.startsWith("branch "));
    const commitLine = lines.find((l) => l.startsWith("HEAD "));
    if (pathLine) {
      const wtPath = pathLine.replace("worktree ", "");
      // Skip the main worktree
      if (resolve(wtPath) === resolve(projectPath)) continue;
      worktrees.push({
        path: wtPath,
        branch: branchLine?.replace("branch refs/heads/", "") ?? "detached",
        commit: commitLine?.replace("HEAD ", "").slice(0, 7) ?? "",
      });
    }
  }
  return worktrees;
}

function scanTodoComments(projectPath: string): TodoComment[] {
  const raw = run(
    `grep -rn "TODO\\|FIXME\\|HACK\\|XXX" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" ${projectPath}/src 2>/dev/null | head -20`,
    projectPath,
  );
  if (!raw) return [];
  const comments: TodoComment[] = [];
  const seen = new Set<string>();
  for (const line of raw.split("\n").filter(Boolean)) {
    const match = line.match(
      /^(.+?):(\d+):.*(?:TODO|FIXME|HACK|XXX):?\s*(.*)/i,
    );
    if (match) {
      const [, file, lineNum, text] = match;
      const cleanText = text.trim();
      if (cleanText.length < 5 || seen.has(cleanText)) continue;
      seen.add(cleanText);
      comments.push({
        file: relative(projectPath, file),
        line: parseInt(lineNum, 10),
        text: cleanText,
        isBug: /FIXME|HACK|XXX/.test(line),
      });
    }
  }
  return comments;
}

// ── analyzeProject — pure data gathering ────────

export function analyzeProject(projectPath: string): ProjectAnalysis {
  const p = resolve(projectPath);
  const projectName = basename(p);

  // Check if this is a git repo (not just that git is installed)
  const hasGit = run("git rev-parse --is-inside-work-tree", p) === "true";

  // Git info (all empty strings if no git)
  const gitLog = hasGit ? run("git log --oneline -30", p) : "";
  const currentBranch = hasGit ? run("git branch --show-current", p) : "";
  const totalCommits = hasGit
    ? run("git rev-list --count HEAD 2>/dev/null", p) || "0"
    : "0";
  const lastCommitMsg = hasGit ? run("git log -1 --pretty=%B", p) : "";
  const lastCommitDate = hasGit ? run("git log -1 --pretty=%ai", p) : "";
  const gitBranches = hasGit ? run("git branch -a --no-color", p) : "";

  // Docs
  const claudeMd = readFile(p, "CLAUDE.md");
  const designMd = readFile(p, "DESIGN.md");
  const readmeMd = readFile(p, "README.md");
  const todoMd = readFile(p, "tasks/todo.md");
  const productRoadmap = readFile(p, "tasks/product-roadmap.md");
  const lessonsMd = readFile(p, "tasks/lessons.md");

  // Package
  const pkgRaw = readFile(p, "package.json");
  let pkg: any = {};
  try {
    if (pkgRaw) pkg = JSON.parse(pkgRaw);
  } catch {}

  // Files
  const testFiles = [
    ...findFiles(p, "*.test.ts"),
    ...findFiles(p, "*.test.tsx"),
    ...findFiles(p, "*.test.js"),
    ...findFiles(p, "*.spec.ts"),
    ...findFiles(p, "*.spec.tsx"),
    ...findFiles(p, "*.spec.js"),
  ];

  const srcFiles = [
    ...findFiles(p, "*.ts"),
    ...findFiles(p, "*.tsx"),
    ...findFiles(p, "*.js"),
    ...findFiles(p, "*.jsx"),
  ].filter(
    (f) =>
      !f.includes(".test.") &&
      !f.includes(".spec.") &&
      !f.includes("node_modules"),
  );

  return {
    projectName,
    projectPath: p,
    hasGit,
    gitLog,
    currentBranch,
    totalCommits,
    lastCommitMsg,
    lastCommitDate,
    gitBranches,
    pkg,
    techStack: detectTechStack(pkg, p),
    srcFiles,
    testFiles,
    claudeMd,
    designMd,
    readmeMd,
    todoMd,
    productRoadmap,
    lessonsMd,
    todoComments: hasGit ? scanTodoComments(p) : [],
    worktrees: hasGit ? detectWorktrees(p) : [],
  };
}

// ── createCardsFromAnalysis — DB writes ─────────

interface CardOpts {
  column: Column;
  type?: CardType;
  priority?: Priority;
  description?: string;
  decisions?: { text: string; reasoning?: string }[];
  files?: string[];
}

export function createCardsFromAnalysis(
  analysis: ProjectAnalysis,
  opts?: {
    onCard?: (title: string, column: string, shortId: string) => void;
    prefix?: string;
  },
): number {
  const a = analysis;
  const onCard = opts?.onCard ?? (() => {});

  // Check if board already has cards
  const existing = listCards();
  if (existing.length > 0) return 0;

  // Set project prefix
  const db = getDb();
  const prefix =
    (opts?.prefix ??
      a.projectName
        .toUpperCase()
        .slice(0, 4)
        .replace(/[^A-Z]/g, "")) ||
    "KB";
  setMeta(db, "prefix", prefix);

  // Wrap all inserts in a transaction for performance
  db.exec("BEGIN");

  let count = 0;

  function card(title: string, cardOpts: CardOpts) {
    const c = createCard(title, {
      column: cardOpts.column,
      type: cardOpts.type ?? "feature",
      priority: cardOpts.priority ?? 3,
      description: cardOpts.description,
    });

    if (cardOpts.decisions) {
      for (const d of cardOpts.decisions) {
        addDecision(c.id, d.text, d.reasoning);
      }
    }
    if (cardOpts.files) {
      for (const f of cardOpts.files) {
        addCardFile(c.id, f);
      }
    }

    count++;
    onCard(title, cardOpts.column, c.short_id);
    return c;
  }

  // ── 1. Project overview ───────────────────────
  const contextDesc = [
    `**${a.pkg.name ?? a.projectName}** ${a.pkg.version ? `v${a.pkg.version}` : ""}`,
    a.pkg.description ? `\n${a.pkg.description}` : "",
    `\nStack: ${a.techStack.join(", ") || "Unknown"}`,
    `Source files: ${a.srcFiles.length} | Test files: ${a.testFiles.length}`,
    `Commits: ${a.totalCommits} | Branch: ${a.currentBranch || "main"}`,
    a.lastCommitDate ? `Last commit: ${a.lastCommitDate.slice(0, 10)}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  card("Project Overview & Tech Stack", {
    column: "done",
    type: "chore",
    priority: 5,
    description: contextDesc,
    decisions: [
      {
        text: `Tech stack: ${a.techStack.join(", ")}`,
        reasoning: "Auto-detected from package.json",
      },
      ...(a.claudeMd
        ? [
            {
              text: "CLAUDE.md exists with project instructions",
              reasoning: `${a.claudeMd.length} chars`,
            },
          ]
        : []),
      ...(a.designMd
        ? [
            {
              text: "DESIGN.md exists with design system",
              reasoning: `${a.designMd.length} chars`,
            },
          ]
        : []),
    ],
    files: [
      "package.json",
      ...(a.claudeMd ? ["CLAUDE.md"] : []),
      ...(a.designMd ? ["DESIGN.md"] : []),
    ],
  });

  // ── 2. Git history → done cards ───────────────
  if (a.gitLog) {
    const commits = a.gitLog.split("\n").filter(Boolean);

    const majorCommits = commits.filter((c) => {
      const msg = c.replace(/^[a-f0-9]+ /, "").toLowerCase();
      return (
        msg.includes("add ") ||
        msg.includes("implement") ||
        msg.includes("create") ||
        msg.includes("build") ||
        msg.includes("setup") ||
        msg.includes("initial") ||
        msg.includes("feat") ||
        msg.includes("refactor") ||
        msg.includes("migrate")
      );
    });

    const fixCommits = commits.filter((c) => {
      const msg = c.replace(/^[a-f0-9]+ /, "").toLowerCase();
      return (
        msg.includes("fix") || msg.includes("bug") || msg.includes("patch")
      );
    });

    for (const commit of majorCommits.slice(0, 15)) {
      const [hash, ...rest] = commit.split(" ");
      card(rest.join(" "), {
        column: "done",
        type: "feature",
        priority: 4,
        description: `Commit: ${hash}`,
        decisions: [{ text: `Shipped in commit ${hash}` }],
      });
    }

    for (const commit of fixCommits.slice(0, 8)) {
      const [hash, ...rest] = commit.split(" ");
      card(rest.join(" "), {
        column: "done",
        type: "bug",
        priority: 3,
        description: `Commit: ${hash}`,
      });
    }

    // Import all commits as prompt history entries
    for (const commit of commits.slice(0, 30)) {
      const [hash, ...rest] = commit.split(" ");
      const subject = rest.join(" ");
      // Get full commit message for prompt text
      const fullMsg = run(
        `git log -1 --pretty=%B ${hash} 2>/dev/null`,
        a.projectPath,
      );
      addPrompt(subject, fullMsg || subject, {
        source: "git_commit",
        commitHash: hash,
        createdAt:
          run(`git log -1 --pretty=%aI ${hash} 2>/dev/null`, a.projectPath) ||
          undefined,
      });
    }
  }

  // ── 3. TODO/roadmap → backlog/sprint ──────────
  if (a.todoMd) {
    for (const item of parseTodoItems(a.todoMd)) {
      if (item.done) continue;
      card(item.text, {
        column: "sprint",
        type: "feature",
        priority: 3,
        description: "From tasks/todo.md",
      });
    }
  }

  if (a.productRoadmap) {
    const phases = a.productRoadmap.split(/^#+\s+/m).filter(Boolean);
    for (const phase of phases) {
      const items = parseTodoItems(phase);
      const phaseTitle = phase.split("\n")[0]?.trim() ?? "";
      for (const item of items) {
        if (item.done) continue;
        const isCurrentPhase =
          phaseTitle.toLowerCase().includes("phase 1") ||
          phaseTitle.toLowerCase().includes("v1.1");
        card(item.text, {
          column: isCurrentPhase ? "sprint" : "backlog",
          type: "feature",
          priority: isCurrentPhase ? 2 : 3,
          description: `Roadmap: ${phaseTitle}`,
        });
      }
    }
  }

  // ── 4. TODO comments → backlog ────────────────
  for (const todo of a.todoComments) {
    card(todo.text || `TODO in ${todo.file}:${todo.line}`, {
      column: "backlog",
      type: todo.isBug ? "bug" : "chore",
      priority: todo.isBug ? 2 : 4,
      description: `Source: ${todo.file}:${todo.line}`,
      files: [todo.file],
    });
  }

  // ── 5. Skipped tests → backlog ────────────────
  for (const testFile of a.testFiles.slice(0, 20)) {
    const content = readFile(a.projectPath, testFile);
    if (!content) continue;
    const skipped = content.matchAll(
      /(?:it|test|describe)\.(?:skip|todo)\s*\(\s*['"](.*?)['"]/g,
    );
    for (const m of skipped) {
      card(`Test TODO: ${m[1]}`, {
        column: "backlog",
        type: "chore",
        priority: 4,
        description: `Skipped test in ${testFile}`,
        files: [testFile],
      });
    }
  }

  // ── 6. Active branches → in_progress ──────────
  if (a.gitBranches) {
    const branches = a.gitBranches
      .split("\n")
      .map((b) => b.trim().replace("* ", ""))
      .filter(
        (b) =>
          b &&
          !b.includes("HEAD") &&
          !b.includes("main") &&
          !b.includes("master") &&
          !b.startsWith("remotes/"),
      );

    for (const branch of branches.slice(0, 5)) {
      const branchCommits = run(
        `git log main..${branch} --oneline 2>/dev/null`,
        a.projectPath,
      );
      if (!branchCommits) continue;
      const commitCount = branchCommits.split("\n").filter(Boolean).length;
      const firstMsg =
        branchCommits.split("\n")[0]?.replace(/^[a-f0-9]+ /, "") ?? branch;
      card(`Branch: ${branch}`, {
        column: "in_progress",
        type: "feature",
        priority: 2,
        description: `${commitCount} commits ahead of main\nLatest: ${firstMsg}`,
        decisions: [
          {
            text: `Active branch with ${commitCount} commits`,
            reasoning: "Git branch analysis",
          },
        ],
      });
    }
  }

  // ── 7. Worktrees → in_progress ────────────────
  for (const wt of a.worktrees) {
    card(`Worktree: ${wt.branch}`, {
      column: "in_progress",
      type: "feature",
      priority: 2,
      description: `Path: ${wt.path}\nBranch: ${wt.branch}\nCommit: ${wt.commit}`,
      decisions: [
        { text: `Git worktree detected`, reasoning: `At ${wt.path}` },
      ],
    });
  }

  // ── 8. Test coverage summary ──────────────────
  if (a.testFiles.length > 0) {
    const testsByDir: Record<string, string[]> = {};
    for (const f of a.testFiles) {
      const dir = f.split("/").slice(0, -1).join("/") || ".";
      (testsByDir[dir] ??= []).push(basename(f));
    }
    const summary = Object.entries(testsByDir)
      .map(([dir, files]) => `${dir}/: ${files.length} test files`)
      .join("\n");

    card("Test Coverage Overview", {
      column: "done",
      type: "chore",
      priority: 5,
      description: `${a.testFiles.length} test files found\n\n${summary}`,
      files: a.testFiles.slice(0, 20),
    });
  }

  // ── 9. Last session context ───────────────────
  if (a.lastCommitMsg) {
    const c = card("Last Session Context", {
      column: "review",
      type: "spike",
      priority: 2,
      description: [
        `Last commit: ${a.lastCommitDate?.slice(0, 10) ?? "unknown"}`,
        `Branch: ${a.currentBranch || "main"}`,
        `Message: ${a.lastCommitMsg.split("\n")[0]}`,
        "",
        "Review this card when resuming work to pick up where you left off.",
      ].join("\n"),
    });
    addSnapshot(c.id, {
      branch: a.currentBranch || "main",
      commitHash: run("git rev-parse HEAD", a.projectPath).slice(0, 7),
      notes: a.lastCommitMsg.split("\n")[0],
    });
  }

  // ── 10. Design system ─────────────────────────
  if (a.designMd) {
    const sections = a.designMd.match(/^#+\s+.+$/gm) ?? [];
    card("Design System Spec", {
      column: "done",
      type: "spike",
      priority: 4,
      description: `DESIGN.md (${a.designMd.length} chars)\n\nSections:\n${sections
        .slice(0, 15)
        .map((s) => `- ${s.replace(/^#+\s+/, "")}`)
        .join("\n")}`,
      files: ["DESIGN.md"],
      decisions: [{ text: "Design system documented", reasoning: "DESIGN.md" }],
    });
  }

  // ── 11. Lessons ───────────────────────────────
  if (a.lessonsMd) {
    card("Engineering Lessons", {
      column: "done",
      type: "spike",
      priority: 4,
      description: `From tasks/lessons.md:\n\n${a.lessonsMd.slice(0, 500)}`,
      files: ["tasks/lessons.md"],
    });
  }

  db.exec("COMMIT");
  return count;
}

// ── Incremental sync (add new items without wiping) ──

export function incrementalSync(
  projectPath: string,
  opts?: {
    onCard?: (title: string, column: string, shortId: string) => void;
    onPrompt?: (summary: string) => void;
  },
): { newCards: number; newPrompts: number } {
  const a = analyzeProject(resolve(projectPath));
  process.chdir(a.projectPath);

  const db = getDb();
  db.exec("BEGIN");

  let newCards = 0;
  let newPrompts = 0;
  const onCard = opts?.onCard ?? (() => {});
  const onPrompt = opts?.onPrompt ?? (() => {});

  // Import new git commits as prompts
  if (a.gitLog) {
    const commits = a.gitLog.split("\n").filter(Boolean);
    for (const commit of commits.slice(0, 30)) {
      const [hash, ...rest] = commit.split(" ");
      if (hasPromptForCommit(hash)) continue;
      const subject = rest.join(" ");
      const fullMsg = run(
        `git log -1 --pretty=%B ${hash} 2>/dev/null`,
        a.projectPath,
      );
      addPrompt(subject, fullMsg || subject, {
        source: "git_commit",
        commitHash: hash,
        createdAt:
          run(`git log -1 --pretty=%aI ${hash} 2>/dev/null`, a.projectPath) ||
          undefined,
      });
      newPrompts++;
      onPrompt(subject);
    }
  }

  // Import new TODO comments as backlog cards
  for (const todo of a.todoComments) {
    const title = todo.text || `TODO in ${todo.file}:${todo.line}`;
    if (hasCardWithTitle(title)) continue;
    const c = createCard(title, {
      column: "backlog",
      type: todo.isBug ? "bug" : "chore",
      priority: todo.isBug ? 2 : 4,
      description: `Source: ${todo.file}:${todo.line}`,
    });
    addCardFile(c.id, todo.file);
    newCards++;
    onCard(title, "backlog", c.short_id);
  }

  // Import new skipped tests as backlog cards
  for (const testFile of a.testFiles.slice(0, 20)) {
    const content = readFile(a.projectPath, testFile);
    if (!content) continue;
    const skipped = content.matchAll(
      /(?:it|test|describe)\.(?:skip|todo)\s*\(\s*['"](.*?)['"]/g,
    );
    for (const m of skipped) {
      const title = `Test TODO: ${m[1]}`;
      if (hasCardWithTitle(title)) continue;
      const c = createCard(title, {
        column: "backlog",
        type: "chore",
        priority: 4,
        description: `Skipped test in ${testFile}`,
      });
      addCardFile(c.id, testFile);
      newCards++;
      onCard(title, "backlog", c.short_id);
    }
  }

  db.exec("COMMIT");
  return { newCards, newPrompts };
}

// ── Direct execution ────────────────────────────

if (import.meta.main) {
  const projectPath = resolve(process.argv[2] ?? process.cwd());

  if (!existsSync(projectPath)) {
    console.error(`Path not found: ${projectPath}`);
    process.exit(1);
  }

  process.chdir(projectPath);

  const dim = "\x1b[2m";
  const reset = "\x1b[0m";
  const green = "\x1b[32m";
  const cyan = "\x1b[38;5;81m";
  const bold = "\x1b[1m";
  const yellow = "\x1b[33m";

  console.log(
    `\n${cyan}◈${reset} ${bold}Syncing project: ${basename(projectPath)}${reset}`,
  );
  console.log(`${dim}  Path: ${projectPath}${reset}\n`);

  // Check for existing board
  const existing = listCards();
  if (existing.length > 0) {
    console.log(
      `${yellow}Board already has ${existing.length} cards. Skipping sync to avoid duplicates.${reset}`,
    );
    console.log(`${dim}To re-sync, delete .kanban/board.db first.${reset}`);
    closeDb();
    process.exit(0);
  }

  console.log(`${cyan}Analyzing project...${reset}\n`);
  const analysis = analyzeProject(projectPath);

  const COL_LABEL: Record<string, string> = {
    backlog: "BACKLOG",
    sprint: "SPRINT",
    in_progress: "IN PROGRESS",
    review: "REVIEW",
    done: "DONE",
  };

  const count = createCardsFromAnalysis(analysis, {
    onCard: (title, column, shortId) => {
      console.log(
        `  ${green}+${reset} ${dim}[${COL_LABEL[column] ?? column}]${reset} ${shortId}: ${title}`,
      );
    },
  });

  console.log(
    `\n${green}${bold}Synced ${count} cards${reset} for ${analysis.projectName}`,
  );
  console.log(`${dim}Database: ${projectPath}/.kanban/board.db${reset}`);
  console.log(`\n${cyan}View the board:${reset}`);
  console.log(
    `  cd ${projectPath} && bun run ${resolve(import.meta.dir, "bin.ts")} view`,
  );
  console.log(`  ${dim}or${reset}`);
  console.log(
    `  cd ${projectPath} && bun run ${resolve(import.meta.dir, "bin.ts")} web`,
  );
  console.log("");

  closeDb();
}
