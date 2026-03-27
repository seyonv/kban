import type { Card, Column } from "../models/card";
import { COLUMNS, COLUMN_LABELS } from "../models/card";
import { getMeta, getDb, listCards, autoArchive } from "../db";
import { renderCardCompact } from "./card";
import * as t from "./theme";

export function renderBoard(): string {
  const db = getDb();
  autoArchive();

  const projectName = getProjectName();
  const lastActive = getMeta(db, "last_active");
  const out: string[] = [];

  // Welcome-back header (if > 24h since last active)
  const wb = renderWelcomeBack(lastActive);
  if (wb) {
    out.push(wb);
    out.push("");
  }

  // ── Board Header ──────────────────────────────────────
  const width = Math.min(t.termWidth(), 120);
  const headerContent = ` ${t.bold}${t.white}KANBAN${t.reset}  ${t.dim}${t.dot}  ${projectName}  ${t.dot}  ${formatLastActive(lastActive)}${t.reset} `;
  const headerW = width;

  out.push(`${t.box.tl}${t.heavyH.repeat(headerW - 2)}${t.box.tr}`);
  out.push(`${t.box.v}${t.padR(headerContent, headerW - 2)}${t.box.v}`);
  out.push(`${t.box.bl}${t.heavyH.repeat(headerW - 2)}${t.box.br}`);
  out.push("");

  // ── Gather cards ──────────────────────────────────────
  const cardsByColumn = new Map<Column, Card[]>();
  for (const col of COLUMNS) {
    cardsByColumn.set(col, listCards({ column: col }));
  }

  const totalCards = [...cardsByColumn.values()].reduce(
    (s, c) => s + c.length,
    0,
  );
  if (totalCards === 0) {
    out.push(emptyBoardMessage());
    return out.join("\n");
  }

  // ── Summary bar ───────────────────────────────────────
  const summaryParts = COLUMNS.map((col) => {
    const count = cardsByColumn.get(col)!.length;
    if (count === 0) return null;
    const cc = t.columnColor[col] ?? "";
    const emoji = t.columnEmoji[col] ?? "";
    return `${emoji} ${cc}${t.bold}${count}${t.reset} ${t.dim}${col.replace("_", " ")}${t.reset}`;
  }).filter(Boolean);
  out.push(`  ${summaryParts.join("   ")}`);
  out.push("");

  // ── Column Layout ─────────────────────────────────────
  // Only show columns that have cards, plus always show in_progress
  const activeCols = COLUMNS.filter(
    (col) => col === "in_progress" || (cardsByColumn.get(col)?.length ?? 0) > 0,
  );

  const gap = 3;
  const maxCols = Math.max(1, Math.floor((width + gap) / (24 + gap)));
  const visibleCols = activeCols.slice(0, maxCols);
  const colWidth = Math.min(
    28,
    Math.floor(
      (width - gap * (visibleCols.length - 1) - 4) / visibleCols.length,
    ),
  );

  if (colWidth < 16) {
    // Too narrow — stacked mode
    out.push(renderStacked(cardsByColumn));
    return out.join("\n");
  }

  // ── Column Headers ────────────────────────────────────
  let hdrLine = "  ";
  let ulLine = "  ";
  for (let i = 0; i < visibleCols.length; i++) {
    const col = visibleCols[i];
    const count = cardsByColumn.get(col)!.length;
    const cc = t.columnColor[col] ?? "";
    const emoji = t.columnEmoji[col] ?? "";
    const label = `${emoji} ${cc}${t.bold}${COLUMN_LABELS[col]}${t.reset} ${t.dim}(${count})${t.reset}`;
    hdrLine += t.padR(label, colWidth);
    ulLine += `${cc}${"─".repeat(colWidth)}${t.reset}`;
    if (i < visibleCols.length - 1) {
      hdrLine += " ".repeat(gap);
      ulLine += " ".repeat(gap);
    }
  }
  out.push(hdrLine);
  out.push(ulLine);

  // ── Cards Row by Row ──────────────────────────────────
  const maxCards = Math.max(
    ...visibleCols.map((c) => cardsByColumn.get(c)!.length),
  );
  const cardHeight = 5; // lines per compact card

  for (let row = 0; row < maxCards; row++) {
    const renderedCards: (string[] | null)[] = visibleCols.map((col) => {
      const cards = cardsByColumn.get(col)!;
      return row < cards.length
        ? renderCardCompact(cards[row], colWidth)
        : null;
    });

    for (let line = 0; line < cardHeight; line++) {
      let rowStr = "  ";
      for (let ci = 0; ci < visibleCols.length; ci++) {
        const cardLines = renderedCards[ci];
        if (cardLines && line < cardLines.length) {
          rowStr += cardLines[line];
        } else {
          rowStr += " ".repeat(colWidth);
        }
        if (ci < visibleCols.length - 1) rowStr += " ".repeat(gap);
      }
      out.push(rowStr);
    }

    // Small gap between card rows
    if (row < maxCards - 1) {
      out.push("");
    }
  }

  // ── Footer ────────────────────────────────────────────
  out.push("");
  out.push(
    `  ${t.dim}${t.dot} kanban help for commands  ${t.dot}  kanban next to pick up work${t.reset}`,
  );
  out.push("");

  return out.join("\n");
}

function renderStacked(cardsByColumn: Map<Column, Card[]>): string {
  const lines: string[] = [];
  for (const col of COLUMNS) {
    const cards = cardsByColumn.get(col)!;
    if (cards.length === 0) continue;
    const cc = t.columnColor[col] ?? "";
    const emoji = t.columnEmoji[col] ?? "";
    lines.push(
      `  ${emoji} ${t.bold}${cc}${COLUMN_LABELS[col]}${t.reset} ${t.dim}(${cards.length})${t.reset}`,
    );
    lines.push(`  ${cc}${"─".repeat(36)}${t.reset}`);
    for (const card of cards) {
      const tc = t.typeConfig[card.type] ?? t.typeConfig.feature;
      const pBg = t.priorityBg[card.priority] ?? "";
      const pLabel = t.priorityLabel[card.priority] ?? "?";
      const isDone = card.column === "done";
      const d = isDone ? t.dim : "";
      lines.push(
        `  ${d}${tc.color}${tc.icon}${t.reset} ${d}${t.bold}${card.title}${t.reset}`,
      );
      lines.push(
        `    ${t.dim}${card.short_id}${t.reset}  ${pBg} ${pLabel} ${t.reset}  ${t.dim}${card.type}${t.reset}`,
      );
      lines.push("");
    }
  }
  return lines.join("\n");
}

function emptyBoardMessage(): string {
  return [
    "",
    `  ${t.dim}${t.box.tl}${t.box.h.repeat(44)}${t.box.tr}${t.reset}`,
    `  ${t.dim}${t.box.v}${t.reset}  ${t.bold}Your board is empty.${t.reset}${" ".repeat(22)}${t.dim}${t.box.v}${t.reset}`,
    `  ${t.dim}${t.box.v}${t.reset}${" ".repeat(44)}${t.dim}${t.box.v}${t.reset}`,
    `  ${t.dim}${t.box.v}${t.reset}  ${t.cyan}kanban add "My first task"${t.reset}${" ".repeat(14)}${t.dim}${t.box.v}${t.reset}`,
    `  ${t.dim}${t.box.v}${t.reset}  ${t.cyan}kanban onboard${t.reset}  ${t.dim}scan for TODOs${t.reset}${" ".repeat(8)}${t.dim}${t.box.v}${t.reset}`,
    `  ${t.dim}${t.box.v}${t.reset}${" ".repeat(44)}${t.dim}${t.box.v}${t.reset}`,
    `  ${t.dim}${t.box.bl}${t.box.h.repeat(44)}${t.box.br}${t.reset}`,
    "",
  ].join("\n");
}

function renderWelcomeBack(lastActive: string | null): string | null {
  if (!lastActive) return null;
  const hours =
    (Date.now() - new Date(lastActive).getTime()) / (1000 * 60 * 60);
  if (hours < 24) return null;

  const days = Math.floor(hours / 24);
  const inProgress = listCards({ column: "in_progress" }).length;
  const inReview = listCards({ column: "review" }).length;
  const inSprint = listCards({ column: "sprint" }).length;

  const w = 56;
  return [
    `  ${t.bold}${t.cyan}${t.box.tl}${t.box.h.repeat(w - 2)}${t.box.tr}${t.reset}`,
    `  ${t.bold}${t.cyan}${t.box.v}${t.reset}  ${t.bold}WELCOME BACK${t.reset}  ${t.dim}${t.dot}  last active ${days}d ago${t.reset}${" ".repeat(Math.max(0, w - 38 - String(days).length))}${t.bold}${t.cyan}${t.box.v}${t.reset}`,
    `  ${t.bold}${t.cyan}${t.box.v}${t.reset}  ${t.green}${inProgress} in progress${t.reset}  ${t.yellow}${inReview} in review${t.reset}  ${t.cyan}${inSprint} in sprint${t.reset}${" ".repeat(Math.max(0, w - 46))}${t.bold}${t.cyan}${t.box.v}${t.reset}`,
    `  ${t.bold}${t.cyan}${t.box.bl}${t.box.h.repeat(w - 2)}${t.box.br}${t.reset}`,
  ].join("\n");
}

function getProjectName(): string {
  return process.cwd().split("/").pop() ?? "project";
}

function formatLastActive(lastActive: string | null): string {
  if (!lastActive) return "just now";
  const diff = Date.now() - new Date(lastActive).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
