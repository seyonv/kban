#!/usr/bin/env bun
/**
 * kban init — World-class onboarding wizard.
 *
 * Detects project context, creates a populated kanban board,
 * and opens the web UI in the browser.
 */

import { existsSync, unlinkSync } from "fs";
import { resolve, basename } from "path";
import { listCards, getDb, closeDb } from "./db";
import { analyzeProject, createCardsFromAnalysis } from "./sync";
import { startServer } from "./server";
import {
  printBanner,
  printStep,
  createSpinner,
  ask,
  keypress,
  sleep,
} from "./render/spinner";
import * as t from "./render/theme";
import { COLUMNS, COLUMN_LABELS } from "./models/card";

const VERSION = "0.1.0";

async function init() {
  const projectPath = resolve(process.cwd());
  const projectName = basename(projectPath);

  // ── 1. Check for existing board ─────────────────

  const kanbanDir = resolve(projectPath, ".kanban");
  const dbPath = resolve(kanbanDir, "board.db");

  if (existsSync(dbPath)) {
    const existingCards = listCards();
    const count = existingCards.length;

    printBanner(VERSION);
    console.log(
      `  ${t.yellow}Existing board found${t.reset} ${t.dim}(${count} cards)${t.reset}`,
    );
    console.log("");

    const choice = await keypress("What would you like to do?", [
      "open existing board",
      "reset & re-sync",
      "quit",
    ]);

    if (choice === "q") {
      console.log(`  ${t.dim}Bye!${t.reset}`);
      closeDb();
      process.exit(0);
    }

    if (choice === "o") {
      console.log(`  ${t.cyan}Starting board...${t.reset}`);
      const { port } = startServer();
      openBrowser(port);
      return;
    }

    // Reset: delete the database files
    closeDb();
    for (const ext of ["", "-wal", "-shm"]) {
      const f = dbPath + ext;
      if (existsSync(f)) unlinkSync(f);
    }
    console.log(`  ${t.dim}Board reset.${t.reset}\n`);
  }

  // ── 2. Welcome banner ──────────────────────────

  printBanner(VERSION);

  // ── 3. Analyze project ─────────────────────────

  const spinner = createSpinner("Detecting project...");
  await sleep(200);

  const analysis = analyzeProject(projectPath);

  spinner.stop();

  // ── 4. Display detection results ───────────────

  // Git
  if (analysis.hasGit) {
    printStep(
      `${t.green}✓${t.reset}`,
      `${t.bold}Git repository${t.reset}`,
      `${analysis.currentBranch || "main"} ${t.dot} ${analysis.totalCommits} commits`,
    );
  } else {
    printStep(
      `${t.red}✗${t.reset}`,
      `${t.dim}Git not found — board will have limited context${t.reset}`,
    );
  }
  await sleep(80);

  // Package.json
  if (analysis.pkg.name) {
    printStep(
      `${t.green}✓${t.reset}`,
      `${t.bold}package.json${t.reset}`,
      `${analysis.pkg.name} ${analysis.pkg.version ? `v${analysis.pkg.version}` : ""}`,
    );
  } else {
    printStep(`${t.red}✗${t.reset}`, `${t.dim}No package.json${t.reset}`);
  }
  await sleep(80);

  // CLAUDE.md
  if (analysis.claudeMd) {
    printStep(
      `${t.green}✓${t.reset}`,
      `${t.bold}CLAUDE.md${t.reset}`,
      `${analysis.claudeMd.length.toLocaleString()} chars of context`,
    );
  } else {
    printStep(`${t.red}✗${t.reset}`, `${t.dim}No CLAUDE.md${t.reset}`);
  }
  await sleep(60);

  // DESIGN.md
  if (analysis.designMd) {
    printStep(
      `${t.green}✓${t.reset}`,
      `${t.bold}DESIGN.md${t.reset}`,
      `${analysis.designMd.length.toLocaleString()} chars of specs`,
    );
  } else {
    printStep(`${t.red}✗${t.reset}`, `${t.dim}No DESIGN.md${t.reset}`);
  }
  await sleep(60);

  // Source files
  printStep(
    analysis.srcFiles.length > 0
      ? `${t.green}✓${t.reset}`
      : `${t.red}✗${t.reset}`,
    `${t.bold}Source files${t.reset}`,
    `${analysis.srcFiles.length} files`,
  );
  await sleep(60);

  // Test files
  printStep(
    analysis.testFiles.length > 0
      ? `${t.green}✓${t.reset}`
      : `${t.red}✗${t.reset}`,
    `${t.bold}Test files${t.reset}`,
    `${analysis.testFiles.length} files`,
  );
  await sleep(60);

  // Tech stack
  if (analysis.techStack.length > 0) {
    printStep(
      `${t.green}✓${t.reset}`,
      `${t.bold}Stack${t.reset}`,
      analysis.techStack.join(", "),
    );
  }
  await sleep(60);

  // Worktrees
  if (analysis.worktrees.length > 0) {
    printStep(
      `${t.green}✓${t.reset}`,
      `${t.bold}Worktrees${t.reset}`,
      `${analysis.worktrees.length} found`,
    );
    for (const wt of analysis.worktrees) {
      console.log(
        `      ${t.dim}${wt.branch}${t.reset}  ${t.dimGray}${wt.path}${t.reset}`,
      );
    }
  }

  // TODO comments
  if (analysis.todoComments.length > 0) {
    printStep(
      `${t.yellow}!${t.reset}`,
      `${t.bold}TODO comments${t.reset}`,
      `${analysis.todoComments.length} found in source`,
    );
  }

  console.log("");

  // ── 5. Confirm prefix ─────────────────────────

  const defaultPrefix =
    projectName
      .toUpperCase()
      .slice(0, 4)
      .replace(/[^A-Z]/g, "") || "KB";

  console.log(`  ${t.bold}Project:${t.reset} ${projectName}`);

  const prefix = await ask("Card prefix", defaultPrefix);
  const cleanPrefix =
    prefix
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 6) || defaultPrefix;

  console.log(
    `\n  ${t.dim}Cards will be ${cleanPrefix}-1, ${cleanPrefix}-2, ...${t.reset}\n`,
  );

  // ── 6. Create cards ───────────────────────────

  const COL_LABEL: Record<string, string> = {
    backlog: "BACKLOG",
    sprint: "SPRINT",
    in_progress: "IN PROGRESS",
    review: "REVIEW",
    done: "DONE",
  };

  console.log(`  ${t.bold}Creating board...${t.reset}\n`);

  const count = createCardsFromAnalysis(analysis, {
    prefix: cleanPrefix,
    onCard: (title, column, shortId) => {
      const colColor = t.columnColor[column] ?? "";
      console.log(
        `    ${t.green}+${t.reset} ${t.dim}[${COL_LABEL[column] ?? column}]${t.reset} ${colColor}${shortId}${t.reset}  ${title}`,
      );
    },
  });

  // ── 7. Summary ────────────────────────────────

  console.log("");

  const counts: Record<string, number> = {};
  const allCards = listCards();
  for (const card of allCards) {
    counts[card.column] = (counts[card.column] ?? 0) + 1;
  }

  const summaryParts = COLUMNS.filter((col) => counts[col]).map((col) => {
    const emoji = {
      backlog: "📋",
      sprint: "🎯",
      in_progress: "🔨",
      review: "👀",
      done: "✅",
    };
    return `${emoji[col] ?? ""} ${counts[col]} ${COLUMN_LABELS[col].toLowerCase()}`;
  });

  const summaryW = 44;
  console.log(
    `  ${t.dim}${t.box.tl}${"─".repeat(summaryW)}${t.box.tr}${t.reset}`,
  );
  console.log(
    `  ${t.dim}${t.box.v}${t.reset}  ${t.bold}${t.green}✓ Created ${count} cards${t.reset}${" ".repeat(Math.max(0, summaryW - 16 - String(count).length))}${t.dim}${t.box.v}${t.reset}`,
  );
  console.log(
    `  ${t.dim}${t.box.v}${t.reset}${" ".repeat(summaryW)}${t.dim}${t.box.v}${t.reset}`,
  );

  // Print summary in rows of 2
  for (let i = 0; i < summaryParts.length; i += 2) {
    const left = summaryParts[i] ?? "";
    const right = summaryParts[i + 1] ?? "";
    const row = `  ${left}${right ? `    ${right}` : ""}`;
    const vis = row.replace(/\x1b\[[0-9;]*m/g, "").length;
    console.log(
      `  ${t.dim}${t.box.v}${t.reset}${row}${" ".repeat(Math.max(0, summaryW - vis))}${t.dim}${t.box.v}${t.reset}`,
    );
  }

  console.log(
    `  ${t.dim}${t.box.bl}${"─".repeat(summaryW)}${t.box.br}${t.reset}`,
  );
  console.log("");

  // ── 8. Start server ───────────────────────────

  console.log(`  ${t.cyan}Starting board...${t.reset}\n`);

  const { port } = startServer();
  openBrowser(port);
}

function openBrowser(port: number) {
  const url = `http://localhost:${port}`;
  try {
    const cmd =
      process.platform === "darwin"
        ? "open"
        : process.platform === "win32"
          ? "start"
          : "xdg-open";
    Bun.spawn([cmd, url], { stdout: "ignore", stderr: "ignore" });
  } catch {
    // Browser open failed — URL is already printed by startServer
  }
}

// Run
init().catch((err) => {
  console.error(`\n${t.red}Error: ${err.message}${t.reset}`);
  closeDb();
  process.exit(1);
});
