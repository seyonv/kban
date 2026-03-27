import type { Card } from "../models/card";
import { getDecisions, getSnapshots, getCardFiles } from "../db";
import * as t from "./theme";

export function renderCardDetail(card: Card): string {
  const lines: string[] = [];
  const w = Math.min(t.termWidth(), 70);

  // Header
  const pc = t.priorityColor[card.priority] || "";
  const pLabel = `P${card.priority}`;
  const status = card.column.replace("_", " ");
  const days =
    card.column === "in_progress" ? ` (${daysSince(card.updated_at)}d)` : "";
  const headerText = `  ${card.short_id}  ·  ${pc}${pLabel}${t.reset}  ·  ${card.type}  ·  ${status}${days}  `;

  lines.push(
    `${t.bold}${t.box.tl}${t.box.h.repeat(w - 2)}${t.box.tr}${t.reset}`,
  );
  lines.push(
    `${t.bold}${t.box.v}${padRight(headerText, w - 2)}${t.box.v}${t.reset}`,
  );
  lines.push(
    `${t.bold}${t.box.bl}${t.box.h.repeat(w - 2)}${t.box.br}${t.reset}`,
  );
  lines.push("");

  // Title
  lines.push(`  ${t.bold}${card.title}${t.reset}`);
  lines.push("");

  // Description
  if (card.description) {
    lines.push(`  ${card.description}`);
    lines.push("");
  }

  // Files
  const files = getCardFiles(card.id);
  if (files.length > 0) {
    lines.push(`  ${t.bold}FILES${t.reset}`);
    lines.push(`  ${t.dim}${"─".repeat(w - 4)}${t.reset}`);
    for (const f of files) {
      lines.push(`  ${t.cyan}${f}${t.reset}`);
    }
    lines.push("");
  }

  // Decision log
  const decisions = getDecisions(card.id);
  if (decisions.length > 0) {
    lines.push(`  ${t.bold}DECISION LOG${t.reset}`);
    lines.push(`  ${t.dim}${"─".repeat(w - 4)}${t.reset}`);
    for (const d of decisions) {
      const date = d.created_at.slice(0, 10);
      lines.push(`  ${t.dim}${date}${t.reset}  ${d.decision}`);
      if (d.reasoning) {
        lines.push(`  ${t.dim}         WHY: ${d.reasoning}${t.reset}`);
      }
    }
    lines.push("");
  }

  // Context snapshots
  const snapshots = getSnapshots(card.id);
  if (snapshots.length > 0) {
    const latest = snapshots[0];
    lines.push(`  ${t.bold}CONTEXT${t.reset}`);
    lines.push(`  ${t.dim}${"─".repeat(w - 4)}${t.reset}`);
    if (latest.branch)
      lines.push(`  Branch: ${t.cyan}${latest.branch}${t.reset}`);
    if (latest.commit_hash)
      lines.push(`  Commit: ${t.dim}${latest.commit_hash}${t.reset}`);
    if (latest.notes) lines.push(`  Notes:  ${latest.notes}`);
    lines.push("");
  }

  return lines.join("\n");
}

function padRight(s: string, w: number): string {
  const visible = s.replace(/\x1b\[[0-9;]*m/g, "");
  const pad = Math.max(0, w - visible.length);
  return s + " ".repeat(pad);
}

function daysSince(isoDate: string): number {
  return Math.max(
    0,
    Math.floor(
      (Date.now() - new Date(isoDate).getTime()) / (1000 * 60 * 60 * 24),
    ),
  );
}
