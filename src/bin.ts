#!/usr/bin/env bun
/**
 * kban — CLI kanban board for developers.
 *
 * Entry point for the `kban` bin command.
 * Routes to init, web server, or CLI commands.
 */

const cmd = process.argv[2] ?? "view";

if (cmd === "init") {
  await import("./init");
} else if (cmd === "web" || cmd === "serve") {
  const { startServer } = await import("./server");
  startServer();
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
