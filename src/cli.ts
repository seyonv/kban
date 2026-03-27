#!/usr/bin/env bun
import {
  createCard,
  resolveCard,
  updateCard,
  moveCard,
  deleteCard,
  listCards,
  addDecision,
  getDecisions,
  getSnapshots,
  getCardFiles,
  closeDb,
} from "./db";
import {
  COLUMNS,
  COLUMN_LABELS,
  type Column,
  type CardType,
} from "./models/card";
import { renderBoard } from "./render/print";
import { renderCardDetail } from "./render/detail";
import * as t from "./render/theme";

function getProjectName(): string {
  return process.cwd().split("/").pop() || "project";
}

export function runCommand(cmd: string, args: string[]): void {
  switch (cmd) {
    case "view":
    case "board":
      console.log(renderBoard());
      break;

    case "add": {
      const title = args.join(" ");
      if (!title) {
        console.error(`${t.red}Error: Title cannot be empty.${t.reset}`);
        console.error(`Usage: kban add "My task title"`);
        process.exit(1);
      }
      const card = createCard(title, { type: "feature" });
      console.log(
        `${t.green}Created ${t.bold}${card.short_id}${t.reset}${t.green}: ${card.title} (${card.column}, P${card.priority})${t.reset}`,
      );
      break;
    }

    case "bug": {
      const title = args.join(" ");
      if (!title) {
        console.error(`${t.red}Error: Title cannot be empty.${t.reset}`);
        process.exit(1);
      }
      const card = createCard(title, { type: "bug" });
      console.log(
        `${t.red}⚠ Created ${t.bold}${card.short_id}${t.reset}${t.red}: ${card.title} (${card.column}, P${card.priority})${t.reset}`,
      );
      break;
    }

    case "show": {
      const id = args[0];
      if (!id) {
        console.error(`${t.red}Error: Specify a card ID.${t.reset}`);
        process.exit(1);
      }
      const card = resolveCard(id);
      if (!card) {
        console.error(
          `${t.red}Card ${id} not found. Run 'kban view' to see all cards.${t.reset}`,
        );
        process.exit(1);
      }
      console.log(renderCardDetail(card));
      break;
    }

    case "edit": {
      const id = args[0];
      if (!id) {
        console.error(`${t.red}Error: Specify a card ID.${t.reset}`);
        process.exit(1);
      }
      const card = resolveCard(id);
      if (!card) {
        console.error(`${t.red}Card ${id} not found.${t.reset}`);
        process.exit(1);
      }
      const updates: any = {};
      for (let i = 1; i < args.length; i++) {
        if (args[i] === "--title" && args[i + 1]) {
          updates.title = args[++i];
        } else if (args[i] === "--desc" && args[i + 1]) {
          updates.description = args[++i];
        } else if (args[i] === "--type" && args[i + 1]) {
          updates.type = args[++i];
        }
      }
      if (Object.keys(updates).length === 0) {
        console.error(
          `Usage: kban edit ${id} --title "New title" --desc "Description" --type bug`,
        );
        process.exit(1);
      }
      updateCard(card.id, updates);
      console.log(`${t.green}Updated ${card.short_id}.${t.reset}`);
      break;
    }

    case "move": {
      const id = args[0];
      const col = args[1] as Column | undefined;
      if (!id || !col) {
        console.error(`Usage: kban move <card-id> <column>`);
        console.error(`Columns: ${COLUMNS.join(", ")}`);
        process.exit(1);
      }
      if (!COLUMNS.includes(col)) {
        console.error(
          `${t.red}Invalid column '${col}'. Valid columns: ${COLUMNS.join(", ")}${t.reset}`,
        );
        process.exit(1);
      }
      const card = resolveCard(id);
      if (!card) {
        console.error(`${t.red}Card ${id} not found.${t.reset}`);
        process.exit(1);
      }
      moveCard(card.id, col);
      console.log(
        `${t.green}Moved ${card.short_id} → ${COLUMN_LABELS[col]}${t.reset}`,
      );
      break;
    }

    case "done": {
      const id = args[0];
      if (!id) {
        console.error(`Usage: kban done <card-id>`);
        process.exit(1);
      }
      const card = resolveCard(id);
      if (!card) {
        console.error(`${t.red}Card ${id} not found.${t.reset}`);
        process.exit(1);
      }
      moveCard(card.id, "done");
      console.log(
        `${t.green}✓ ${card.short_id}: ${card.title} → DONE${t.reset}`,
      );
      break;
    }

    case "delete": {
      const id = args[0];
      if (!id) {
        console.error(`Usage: kban delete <card-id>`);
        process.exit(1);
      }
      const card = resolveCard(id);
      if (!card) {
        console.error(`${t.red}Card ${id} not found.${t.reset}`);
        process.exit(1);
      }
      deleteCard(card.id);
      console.log(`${t.red}Deleted ${card.short_id}: ${card.title}${t.reset}`);
      break;
    }

    case "priority": {
      const id = args[0];
      const p = parseInt(args[1], 10);
      if (!id || isNaN(p) || p < 1 || p > 5) {
        console.error(`Usage: kban priority <card-id> <1-5>`);
        process.exit(1);
      }
      const card = resolveCard(id);
      if (!card) {
        console.error(`${t.red}Card ${id} not found.${t.reset}`);
        process.exit(1);
      }
      updateCard(card.id, { priority: p as any });
      console.log(`${t.green}${card.short_id} → P${p}${t.reset}`);
      break;
    }

    case "log": {
      const id = args[0];
      const decision = args.slice(1).join(" ");
      if (!id || !decision) {
        console.error(`Usage: kban log <card-id> <decision text>`);
        process.exit(1);
      }
      const card = resolveCard(id);
      if (!card) {
        console.error(`${t.red}Card ${id} not found.${t.reset}`);
        process.exit(1);
      }
      addDecision(card.id, decision);
      console.log(`${t.green}Logged decision on ${card.short_id}.${t.reset}`);
      break;
    }

    case "next": {
      const inProgress = listCards({ column: "in_progress" });
      if (inProgress.length > 0) {
        const current = inProgress[0];
        console.log(
          `${t.yellow}${current.short_id} is already in progress: ${current.title}${t.reset}`,
        );
        console.log("");
        console.log(renderCardDetail(current));
        console.log(
          `${t.dim}To pick a different task, move this one first: kban move ${current.short_id} review${t.reset}`,
        );
        break;
      }

      const sprint = listCards({ column: "sprint" });
      if (sprint.length === 0) {
        console.log(`${t.yellow}Sprint is empty.${t.reset}`);
        console.log(
          `Move cards from backlog: ${t.cyan}kban move <id> sprint${t.reset}`,
        );
        break;
      }

      const next = sprint[0];
      moveCard(next.id, "in_progress");
      console.log(
        `${t.green}${t.bold}Picked up ${next.short_id}: ${next.title}${t.reset}`,
      );
      console.log("");
      const updated = resolveCard(next.short_id)!;
      console.log(renderCardDetail(updated));
      break;
    }

    case "context": {
      const allCards = listCards();
      console.log(`# Board Context — ${getProjectName()}`);
      console.log("");
      for (const col of COLUMNS) {
        const cards = allCards.filter((c) => c.column === col);
        if (cards.length === 0) continue;
        console.log(`## ${COLUMN_LABELS[col]} (${cards.length})`);
        for (const card of cards) {
          console.log(
            `- [${card.short_id}] P${card.priority} ${card.type}: ${card.title}`,
          );
          const decisions = getDecisions(card.id);
          for (const d of decisions) {
            console.log(`  - Decision: ${d.decision}`);
            if (d.reasoning) console.log(`    Why: ${d.reasoning}`);
          }
          const files = getCardFiles(card.id);
          if (files.length > 0) {
            console.log(`  - Files: ${files.join(", ")}`);
          }
        }
        console.log("");
      }
      break;
    }

    case "bugs": {
      const bugs = listCards({ type: "bug" });
      if (bugs.length === 0) {
        console.log(`${t.green}No bugs!${t.reset}`);
        break;
      }
      console.log(`${t.bold}${t.red}BUGS (${bugs.length})${t.reset}`);
      console.log(`${t.red}${"─".repeat(40)}${t.reset}`);
      for (const bug of bugs) {
        console.log(
          `  ${t.red}⚠${t.reset} ${bug.short_id}  P${bug.priority}  ${bug.title}  ${t.dim}[${bug.column}]${t.reset}`,
        );
      }
      break;
    }

    case "archive": {
      const archived = listCards({ archived: true });
      if (archived.length === 0) {
        console.log(`${t.dim}No archived cards.${t.reset}`);
        break;
      }
      console.log(`${t.bold}ARCHIVED (${archived.length})${t.reset}`);
      console.log(`${t.dim}${"─".repeat(40)}${t.reset}`);
      for (const card of archived) {
        console.log(
          `  ${t.dim}${card.short_id}  ${card.title}  completed ${card.completed_at?.slice(0, 10) ?? "?"}${t.reset}`,
        );
      }
      break;
    }

    case "help":
    default:
      if (cmd !== "help") {
        console.error(`${t.red}Unknown command: ${cmd}${t.reset}`);
        console.error("");
      }
      console.log(`${t.bold}kban${t.reset} — CLI Kanban Board`);
      console.log("");
      console.log(`${t.bold}Commands:${t.reset}`);
      console.log(
        `  ${t.cyan}init${t.reset}                    Set up board for this project`,
      );
      console.log(
        `  ${t.cyan}view${t.reset}                    Show the board`,
      );
      console.log(
        `  ${t.cyan}web${t.reset}                     Open web UI in browser`,
      );
      console.log(
        `  ${t.cyan}add <title>${t.reset}             Add a feature card`,
      );
      console.log(
        `  ${t.cyan}bug <title>${t.reset}             Add a bug card`,
      );
      console.log(
        `  ${t.cyan}show <id>${t.reset}               Show card detail`,
      );
      console.log(
        `  ${t.cyan}edit <id> --title ...${t.reset}   Edit card fields`,
      );
      console.log(
        `  ${t.cyan}move <id> <column>${t.reset}      Move card to column`,
      );
      console.log(
        `  ${t.cyan}done <id>${t.reset}               Mark card done`,
      );
      console.log(
        `  ${t.cyan}next${t.reset}                    Pick next sprint card`,
      );
      console.log(`  ${t.cyan}priority <id> <1-5>${t.reset}     Set priority`);
      console.log(
        `  ${t.cyan}log <id> <text>${t.reset}         Add decision log entry`,
      );
      console.log(`  ${t.cyan}delete <id>${t.reset}             Delete a card`);
      console.log(
        `  ${t.cyan}context${t.reset}                 Full context dump (for AI)`,
      );
      console.log(
        `  ${t.cyan}bugs${t.reset}                    Show all bug cards`,
      );
      console.log(
        `  ${t.cyan}archive${t.reset}                 Show archived cards`,
      );
      console.log("");
      console.log(`${t.bold}Columns:${t.reset} ${COLUMNS.join(", ")}`);
      break;
  }
}

// Direct execution
if (import.meta.main) {
  const args = process.argv.slice(2);
  const cmd = args[0] ?? "view";
  try {
    runCommand(cmd, args.slice(1));
  } catch (err: any) {
    console.error(`${t.red}Error: ${err.message}${t.reset}`);
    process.exit(2);
  } finally {
    closeDb();
  }
}
