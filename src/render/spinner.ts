/**
 * Animation utilities for the CLI onboarding experience.
 * Imports colors from theme.ts — single source of truth.
 */

import * as t from "./theme";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const isTTY = process.stdout.isTTY ?? false;

// ── Spinner ─────────────────────────────────────

export function createSpinner(text: string) {
  let frameIdx = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let currentText = text;

  function render() {
    const frame = `${t.cyan}${FRAMES[frameIdx]}${t.reset}`;
    process.stdout.write(`\r  ${frame} ${currentText}`);
    frameIdx = (frameIdx + 1) % FRAMES.length;
  }

  function clearLine() {
    if (isTTY) process.stdout.write("\r\x1b[2K");
  }

  if (isTTY) {
    timer = setInterval(render, 80);
    render();
  } else {
    process.stdout.write(`  ... ${text}\n`);
  }

  return {
    update(newText: string) {
      currentText = newText;
      if (!isTTY) process.stdout.write(`  ... ${newText}\n`);
    },

    succeed(msg: string) {
      if (timer) clearInterval(timer);
      timer = null;
      clearLine();
      process.stdout.write(`  ${t.green}✓${t.reset} ${msg}\n`);
    },

    fail(msg: string) {
      if (timer) clearInterval(timer);
      timer = null;
      clearLine();
      process.stdout.write(`  ${t.red}✗${t.reset} ${t.dim}${msg}${t.reset}\n`);
    },

    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      clearLine();
    },
  };
}

// ── Static output helpers ───────────────────────

export function printStep(icon: string, text: string, detail?: string) {
  if (detail) {
    process.stdout.write(`  ${icon} ${text}  ${t.dim}${detail}${t.reset}\n`);
  } else {
    process.stdout.write(`  ${icon} ${text}\n`);
  }
}

export function printBanner(version: string) {
  const w = 40;
  const line1 = `${t.cyan}◈${t.reset}  ${t.bold}kban${t.reset}  ${t.dim}${t.dot}${t.reset}  Project Kanban Board`;
  const line2 = `${t.dim}v${version}${t.reset}`;

  console.log("");
  console.log(`  ${t.dim}${t.box.tl}${"─".repeat(w)}${t.box.tr}${t.reset}`);
  console.log(
    `  ${t.dim}${t.box.v}${t.reset}  ${line1}${" ".repeat(Math.max(0, w - 36))}${t.dim}${t.box.v}${t.reset}`,
  );
  console.log(
    `  ${t.dim}${t.box.v}${t.reset}  ${line2}${" ".repeat(w - 7)}${t.dim}${t.box.v}${t.reset}`,
  );
  console.log(`  ${t.dim}${t.box.bl}${"─".repeat(w)}${t.box.br}${t.reset}`);
  console.log("");
}

// ── User input ──────────────────────────────────

export async function ask(
  question: string,
  defaultVal: string,
): Promise<string> {
  process.stdout.write(`  ${question} ${t.dim}(${defaultVal})${t.reset}: `);

  // Use console from Bun for line reading
  const reader = Bun.stdin.stream().getReader();
  const { value } = await reader.read();
  reader.releaseLock();

  const answer = value ? new TextDecoder().decode(value).trim() : "";
  return answer || defaultVal;
}

export async function keypress(
  prompt: string,
  options: string[],
): Promise<string> {
  const optStr = options
    .map((o) => `${t.bold}${o[0]}${t.reset}${t.dim}${o.slice(1)}${t.reset}`)
    .join("  ");
  process.stdout.write(`  ${prompt}  [${optStr}] `);

  const reader = Bun.stdin.stream().getReader();
  const { value } = await reader.read();
  reader.releaseLock();

  const char = value
    ? new TextDecoder().decode(value).trim().toLowerCase()
    : "";
  console.log("");
  return char;
}

// ── Animation helpers ───────────────────────────

export function sleep(ms: number): Promise<void> {
  return Bun.sleep(ms);
}
