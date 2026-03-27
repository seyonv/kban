# kban

CLI kanban board for developers. Zero deps, SQLite-backed, dark-themed web UI.

```
bunx kban init
```

```
  ╭────────────────────────────────────────╮
  │  ◈  kban  ·  Project Kanban Board      │
  │  v0.1.0                                │
  ╰────────────────────────────────────────╯

  ✓ Git repository         main · 47 commits
  ✓ package.json           preflop v1.0.0
  ✓ CLAUDE.md              1,204 chars of context
  ✓ DESIGN.md              3,890 chars of specs
  ✓ Source files            45 files
  ✓ Test files              14 files
  ✓ Stack                   React, Electron, TypeScript, Vitest, Bun
  ✓ Worktrees               2 found

  Project: preflop
  Card prefix: PREF  (PREF-1, PREF-2, ...):

  Creating board...

    + [DONE]        PREF-1   Project Overview & Tech Stack
    + [DONE]        PREF-2   Initial scaffold: Electron + React
    + [DONE]        PREF-3   Add GTO-approximate ranges
    + [IN PROGRESS] PREF-12  Worktree: ios-companion-app
    + [BACKLOG]     PREF-18  Focus trapping for modal dialogs
    ...

  ✓ Created 24 cards

  ╭────────────────────────────────────────────╮
  │  ✓ Created 24 cards                        │
  │                                            │
  │  📋 8 backlog    🎯 3 sprint               │
  │  🔨 2 in progress  👀 1 review             │
  │  ✅ 10 done                                │
  ╰────────────────────────────────────────────╯

  Starting board → http://localhost:3333
```

Then opens a dark-themed web UI with drag-and-drop:

```
╭━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╮
│ KANBAN  ·  preflop  ·  just now                                   │
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯

  📋 8 backlog   🎯 3 sprint   🔨 2 in progress   👀 1 review   ✅ 10 done

  BACKLOG (8)            SPRINT (3)           IN PROGRESS (2)
  ──────────────         ──────────────       ──────────────
  ┌────────────────┐     ┌────────────────┐   ┌────────────────┐
  │ ◈ Focus trap   │     │ ⚠ Fix card     │   │ ◈ iOS app      │
  │ PREF-18  P4    │     │ PREF-4   P2    │   │ PREF-12  P2    │
  └────────────────┘     └────────────────┘   └────────────────┘
```

---

## What it does

Run `kban init` in any git repo and it automatically builds a kanban board from your project's existing context:

- **Git history** — each major commit becomes a "done" card
- **Active branches** — detected as "in progress" work
- **Git worktrees** — each worktree gets its own card
- **TODO/FIXME comments** — scanned from source code into backlog
- **Skipped tests** — `it.skip()` / `test.todo()` become cards
- **Roadmap files** — parses `tasks/todo.md` and `tasks/product-roadmap.md`
- **Project docs** — detects CLAUDE.md, DESIGN.md, README.md
- **Tech stack** — auto-detects from package.json (React, Vue, Electron, etc.)

The result: when you switch between projects, run `kban` and instantly see where you left off.

---

## Install

Requires [Bun](https://bun.sh) >= 1.0.

```bash
# Run directly (no install)
bunx kban init

# Or install globally
bun install -g kban

# Or add to a project
bun add -D kban
```

---

## Commands

```
kban init                    Set up board for this project
kban view                    Show the board in terminal
kban web                     Open web UI in browser

kban add <title>             Add a feature card
kban bug <title>             Add a bug card
kban show <id>               Show card detail
kban edit <id> --title ...   Edit card fields
kban move <id> <column>      Move card to column
kban done <id>               Mark card done
kban next                    Pick next sprint card
kban priority <id> <1-5>     Set priority
kban log <id> <text>         Add decision log entry
kban delete <id>             Delete a card
kban context                 Full context dump (for AI)
kban bugs                    Show all bug cards
kban archive                 Show archived cards
```

### Columns

`backlog` → `sprint` → `in_progress` → `review` → `done`

### Card types

| Type      | Icon | Use                     |
| --------- | ---- | ----------------------- |
| `feature` | ◈    | New functionality       |
| `bug`     | ⚠    | Something broken        |
| `chore`   | ⚙    | Maintenance, tech debt  |
| `spike`   | ◆    | Research, investigation |

### Priority

| Level | Label | Color     |
| ----- | ----- | --------- |
| P1    | CRIT  | Red       |
| P2    | HIGH  | Orange    |
| P3    | MED   | Blue      |
| P4    | LOW   | Gray      |
| P5    | MIN   | Dark gray |

---

## How it works

```
  bunx kban init
       │
       ▼
  ┌─────────────────────┐
  │  analyzeProject()   │  ← reads git, package.json, docs, TODOs
  └──────────┬──────────┘
             │
             ▼
  ┌─────────────────────┐
  │ createCards...()    │  ← populates SQLite DB at .kanban/board.db
  └──────────┬──────────┘
             │
             ▼
  ┌─────────────────────┐
  │  startServer()      │  ← Bun.serve on port 3333 (with fallback)
  └──────────┬──────────┘
             │
             ▼
       Opens browser
```

- **Database:** SQLite via `bun:sqlite`, stored at `.kanban/board.db` in your git root
- **Web UI:** Single-page dark-themed app with drag-and-drop, served from the package
- **CLI:** Direct SQLite access, no server needed
- **Worktrees:** All worktrees share one board (DB resolves to main repo root)
- **Idempotent:** Running `kban init` again offers to open existing board or reset

---

## Web UI

The web UI runs at `http://localhost:3333` and features:

- Dark theme (GitHub-dark inspired)
- Drag and drop cards between columns
- Click any card for detail modal (decisions, files, context)
- Inline card creation per column
- Priority-colored left borders
- Auto-refreshes every 5 seconds

Start it anytime with:

```bash
kban web
```

---

## Decision log

Every card has a decision log — a timestamped trail of choices made:

```bash
kban log PREF-4 "Chose SQLite over Postgres for portability"
kban show PREF-4
```

This is designed for AI-assisted workflows: when an agent picks up a card, it can read past decisions and continue with full context.

---

## Context dump

Get a markdown summary of your entire board, ready to paste into an AI conversation:

```bash
kban context
```

```markdown
# Board Context — preflop

## In Progress (2)

- [PREF-12] P2 feature: Worktree: ios-companion-app
  - Decision: Git worktree detected
    Why: At /Users/you/.claude/worktrees/ios-companion-app

## Backlog (8)

- [PREF-18] P4 chore: Focus trapping for modal dialogs
  - Files: src/**tests**/bugs.test.ts
    ...
```

---

## Architecture

```
src/
├── bin.ts              ← Entry point (#!/usr/bin/env bun)
├── init.ts             ← Onboarding wizard
├── cli.ts              ← CLI command router
├── server.ts           ← REST API + web UI server
├── sync.ts             ← Project analysis + card generation
├── db.ts               ← SQLite database layer
├── models/
│   └── card.ts         ← Type definitions
├── render/
│   ├── theme.ts        ← ANSI colors + box drawing
│   ├── spinner.ts      ← Animation utilities
│   ├── print.ts        ← Board renderer
│   ├── card.ts         ← Card renderer
│   └── detail.ts       ← Card detail renderer
└── public/
    └── index.html      ← Web UI (single file, dark theme)
```

- **Zero npm dependencies** — everything uses Bun built-ins
- **~1500 lines of TypeScript** total
- **SQLite** for persistence (WAL mode, crash-safe)
- **12 tests** covering sync, DB, and CLI

---

## Configuration

| Env var       | Default | Purpose             |
| ------------- | ------- | ------------------- |
| `KANBAN_PORT` | `3333`  | Web UI port         |
| `NO_COLOR`    | —       | Disable ANSI colors |

The board database is stored at `.kanban/board.db` in your git root. Add `.kanban/` to your `.gitignore` — it's local state, not meant to be shared.

---

## License

MIT
