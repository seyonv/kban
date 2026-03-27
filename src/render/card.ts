import type { Card } from "../models/card";
import * as t from "./theme";

export function renderCardCompact(card: Card, width: number): string[] {
  const lines: string[] = [];
  const inner = width - 2; // border chars

  const tc = t.typeConfig[card.type] ?? t.typeConfig.feature;
  const pc = t.priorityColor[card.priority] ?? "";
  const isDone = card.column === "done";
  const dimAll = isDone ? t.dim : "";

  // Priority badge
  const pBg = t.priorityBg[card.priority] ?? "";
  const pLabel = t.priorityLabel[card.priority] ?? `P${card.priority}`;
  const badge = ` ${pBg} ${pLabel} ${t.reset}`;
  const badgeVis = pLabel.length + 2; // visible chars in badge

  // Title — give it as much room as possible
  const titleMax = inner - 2; // 1 padding each side
  const titleStr = t.truncate(card.title, titleMax);

  // Top border with priority color accent
  lines.push(
    `${dimAll}${pc}${t.cardBox.tl}${t.cardBox.h.repeat(inner)}${t.cardBox.tr}${t.reset}`,
  );

  // Line 1: type icon + title
  const line1 = ` ${tc.color}${tc.icon}${t.reset}${dimAll} ${t.bold}${titleStr}${t.reset}`;
  lines.push(
    `${dimAll}${pc}${t.cardBox.v}${t.reset}${t.padR(line1, inner)}${dimAll}${pc}${t.cardBox.v}${t.reset}`,
  );

  // Line 2: short_id · context-aware metadata
  let metaRight = "";
  if (isDone && card.completed_at) {
    metaRight = card.completed_at.slice(5, 10); // MM-DD
  } else if (card.column === "in_progress") {
    const d = daysSince(card.updated_at);
    metaRight = `${d}d`;
  } else if (card.column === "review") {
    metaRight = "review";
  }

  const idStr = `${t.dim}${card.short_id}${t.reset}`;
  const metaStr = metaRight ? `${t.dim} ${t.dot} ${metaRight}${t.reset}` : "";
  const line2 = ` ${idStr}${metaStr}`;
  lines.push(
    `${dimAll}${pc}${t.cardBox.v}${t.reset}${t.padR(line2, inner)}${dimAll}${pc}${t.cardBox.v}${t.reset}`,
  );

  // Line 3: priority badge + type label
  const typeLabel = `${t.dim}${card.type}${t.reset}`;
  const line3 = ` ${badge} ${typeLabel}`;
  lines.push(
    `${dimAll}${pc}${t.cardBox.v}${t.reset}${t.padR(line3, inner)}${dimAll}${pc}${t.cardBox.v}${t.reset}`,
  );

  // Bottom border
  lines.push(
    `${dimAll}${pc}${t.cardBox.bl}${t.cardBox.h.repeat(inner)}${t.cardBox.br}${t.reset}`,
  );

  return lines;
}

function daysSince(isoDate: string): number {
  return Math.max(
    0,
    Math.floor(
      (Date.now() - new Date(isoDate).getTime()) / (1000 * 60 * 60 * 24),
    ),
  );
}
