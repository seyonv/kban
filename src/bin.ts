#!/usr/bin/env bun
/**
 * kban — CLI kanban board for developers.
 *
 * Entry point for the `kban` bin command.
 * Routes to init, web server, dashboard, or CLI commands.
 */

const cmd = process.argv[2] ?? "view";

if (cmd === "init") {
  await import("./init");
} else if (cmd === "web" || cmd === "serve") {
  const { startServer } = await import("./server");
  startServer();
} else if (cmd === "sync") {
  // Incremental sync — add new items without wiping
  const { incrementalSync } = await import("./sync");
  const { closeDb } = await import("./db");
  const t = await import("./render/theme");
  try {
    const projectPath = process.argv[3] ?? process.cwd();
    console.log(`\n${t.cyan}Syncing...${t.reset}\n`);
    const { newCards, newPrompts } = incrementalSync(projectPath, {
      onCard: (title, column, shortId) => {
        console.log(
          `  ${t.green}+${t.reset} ${t.dim}[${column}]${t.reset} ${shortId}: ${title}`,
        );
      },
      onPrompt: (summary) => {
        console.log(`  ${t.dim}+ prompt:${t.reset} ${summary}`);
      },
    });
    console.log(
      `\n${t.green}${t.bold}+${newCards} cards, +${newPrompts} prompts${t.reset}\n`,
    );
  } finally {
    closeDb();
  }
} else if (cmd === "dashboard") {
  const { runDashboard } = await import("./dashboard");
  await runDashboard();
} else {
  const { runCommand } = await import("./cli");
  const { closeDb } = await import("./db");
  try {
    runCommand(cmd, process.argv.slice(3));
  } catch (err: any) {
    console.error(`\x1b[38;5;196m${err.message}\x1b[0m`);
    process.exit(2);
  } finally {
    closeDb();
  }
}
