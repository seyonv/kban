/**
 * Multi-project dashboard — scan for kban boards across projects.
 */

import { Database } from "bun:sqlite";
import { existsSync, readdirSync } from "fs";
import { resolve, basename } from "path";
import { homedir } from "os";
import * as t from "./render/theme";

export interface ProjectSummary {
  name: string;
  path: string;
  dbPath: string;
  counts: Record<string, number>;
  inProgress: { short_id: string; title: string; priority: number }[];
  sprint: { short_id: string; title: string; priority: number }[];
  lastActive: string | null;
  totalCards: number;
}

function findKbanProjects(roots: string[]): string[] {
  const dbPaths: string[] = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    try {
      const entries = readdirSync(root, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const kanbanDb = resolve(root, entry.name, ".kanban", "board.db");
        if (existsSync(kanbanDb)) {
          dbPaths.push(kanbanDb);
        }
      }
    } catch {
      // Permission denied or other FS errors — skip
    }
  }
  return dbPaths;
}

function readProjectSummary(dbPath: string): ProjectSummary | null {
  try {
    const db = new Database(dbPath, { readonly: true });
    db.exec("PRAGMA busy_timeout=1000");

    const projectPath = resolve(dbPath, "../..");
    const name = basename(projectPath);

    // Card counts by column
    const rows = db
      .query(
        `SELECT "column", COUNT(*) as cnt FROM cards WHERE archived = 0 GROUP BY "column"`,
      )
      .all() as { column: string; cnt: number }[];

    const counts: Record<string, number> = {};
    let totalCards = 0;
    for (const r of rows) {
      counts[r.column] = r.cnt;
      totalCards += r.cnt;
    }

    // In-progress cards
    const inProgress = db
      .query(
        `SELECT short_id, title, priority FROM cards WHERE "column" = 'in_progress' AND archived = 0 ORDER BY priority ASC LIMIT 5`,
      )
      .all() as { short_id: string; title: string; priority: number }[];

    // Sprint cards
    const sprint = db
      .query(
        `SELECT short_id, title, priority FROM cards WHERE "column" = 'sprint' AND archived = 0 ORDER BY priority ASC LIMIT 5`,
      )
      .all() as { short_id: string; title: string; priority: number }[];

    // Last active
    const meta = db
      .query("SELECT value FROM project_meta WHERE key = 'last_active'")
      .get() as { value: string } | null;

    db.close();

    return {
      name,
      path: projectPath,
      dbPath,
      counts,
      inProgress,
      sprint,
      lastActive: meta?.value ?? null,
      totalCards,
    };
  } catch {
    return null;
  }
}

export function scanProjects(extraRoots?: string[]): ProjectSummary[] {
  const home = homedir();
  const defaultRoots = [
    resolve(home, "Desktop/repos"),
    resolve(home, "projects"),
    resolve(home, "code"),
    resolve(home, "dev"),
  ];

  // Also check cwd's parent (if user is inside a project)
  const cwdParent = resolve(process.cwd(), "..");
  if (!defaultRoots.includes(cwdParent)) {
    defaultRoots.push(cwdParent);
  }

  const roots = [...defaultRoots, ...(extraRoots ?? [])];
  const dbPaths = findKbanProjects(roots);
  const summaries: ProjectSummary[] = [];

  for (const dbPath of dbPaths) {
    const summary = readProjectSummary(dbPath);
    if (summary && summary.totalCards > 0) {
      summaries.push(summary);
    }
  }

  // Sort by last active (most recent first)
  summaries.sort((a, b) => {
    if (!a.lastActive) return 1;
    if (!b.lastActive) return -1;
    return b.lastActive.localeCompare(a.lastActive);
  });

  return summaries;
}

// ── CLI Dashboard ───────────────────────────────

export async function runDashboard() {
  console.log(
    `\n${t.cyan}◈${t.reset} ${t.bold}Multi-Project Dashboard${t.reset}\n`,
  );

  const projects = scanProjects();

  if (projects.length === 0) {
    console.log(`${t.dim}No kban boards found.${t.reset}`);
    console.log(
      `${t.dim}Run 'kban init' in a project to create one.${t.reset}\n`,
    );
    return;
  }

  for (const p of projects) {
    const ago = p.lastActive ? timeAgo(p.lastActive) : "unknown";
    console.log(`  ${t.bold}${p.name}${t.reset}  ${t.dim}${ago}${t.reset}`);
    console.log(`  ${t.dim}${p.path}${t.reset}`);

    const parts: string[] = [];
    if (p.counts.backlog)
      parts.push(`${t.gray}${p.counts.backlog} backlog${t.reset}`);
    if (p.counts.sprint)
      parts.push(`${t.cyan}${p.counts.sprint} sprint${t.reset}`);
    if (p.counts.in_progress)
      parts.push(`${t.green}${p.counts.in_progress} in progress${t.reset}`);
    if (p.counts.review)
      parts.push(`${t.yellow}${p.counts.review} review${t.reset}`);
    if (p.counts.done)
      parts.push(`${t.dimGray}${p.counts.done} done${t.reset}`);
    console.log(`  ${parts.join("  ")}`);

    if (p.inProgress.length > 0) {
      for (const card of p.inProgress) {
        console.log(
          `    ${t.green}▸${t.reset} ${card.short_id}  ${card.title}`,
        );
      }
    }
    console.log("");
  }

  console.log(
    `${t.dim}${projects.length} projects with kban boards${t.reset}\n`,
  );
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
