# Kanban Board Skill — Design System

## Classification

**App UI** — workspace-driven, data-dense, task-focused CLI tool.
Calm surface hierarchy, dense but readable, utility language, minimal chrome.

## Color Palette

### Priority Colors (256-color / 16-color fallback)

| Priority      | 256-color | 16-color fallback | Usage                       |
| ------------- | --------- | ----------------- | --------------------------- |
| P1 (critical) | `196`     | bright red        | Card accent, priority badge |
| P2 (high)     | `214`     | bright yellow     | Card accent, priority badge |
| P3 (normal)   | `39`      | bright blue       | Card accent, priority badge |
| P4 (low)      | `245`     | white             | Card accent, priority badge |
| P5 (minimal)  | `240`     | dim               | Card accent, priority badge |

### Column Colors

| Column      | 256-color        | 16-color fallback |
| ----------- | ---------------- | ----------------- |
| BACKLOG     | `245` (gray)     | white             |
| SPRINT      | `51` (cyan)      | bright cyan       |
| IN_PROGRESS | `82` (green)     | bright green      |
| REVIEW      | `214` (yellow)   | bright yellow     |
| DONE        | `240` (dim gray) | dim               |

### Card Type Indicators

| Type    | Prefix | Color      |
| ------- | ------ | ---------- |
| feature | (none) | default    |
| bug     | `⚠`    | red-tinted |
| chore   | `○`    | gray       |
| spike   | `◆`    | cyan       |

### Semantic Colors

| Usage                   | Color                         |
| ----------------------- | ----------------------------- |
| Board header background | inverse video (white on dark) |
| Success messages        | green                         |
| Error messages          | red                           |
| Warning/prompts         | yellow                        |
| Dim/inactive content    | `240` / dim                   |

## Brightness Hierarchy (4 levels)

| Level      | Usage                              | ANSI Formatting |
| ---------- | ---------------------------------- | --------------- |
| PRIMARY    | Board header, project name         | BOLD + BRIGHT   |
| SECONDARY  | Column headers, counts             | BOLD            |
| TERTIARY   | Card titles, action text           | standard        |
| QUATERNARY | Card metadata (ID, priority, type) | DIM             |

## Box-Drawing Characters

| Element         | Characters | Weight               |
| --------------- | ---------- | -------------------- |
| Board frame     | `╭╮╰╯│─`   | heavy (prominent)    |
| Cards           | `┌┐└┘│─`   | light (subordinate)  |
| Column dividers | `─`        | thin horizontal rule |
| Progress bar    | `▪▫`       | block characters     |

## Spacing Rules

| Element                      | Padding/Gap                   |
| ---------------------------- | ----------------------------- |
| Card internal padding        | 1 char horizontal, 0 vertical |
| Between cards (vertical)     | 1 blank line                  |
| Between columns (horizontal) | 4 chars                       |
| Board header margin          | 1 blank line above, 1 below   |
| Column header to first card  | 1 blank line                  |

## Card Layout (Context-Aware)

Cards show different metadata depending on their column:

| Column      | Line 1               | Line 2                     | Line 3           |
| ----------- | -------------------- | -------------------------- | ---------------- |
| BACKLOG     | `[icon] title`       | `ID  priority type`        |                  |
| SPRINT      | `[icon] title`       | `ID  priority type`        |                  |
| IN_PROGRESS | `[icon] title`       | `ID  priority  2d`         | (time in column) |
| REVIEW      | `[icon] title`       | `ID  priority  branch`     |                  |
| DONE        | `[icon] title` (DIM) | `ID  completed date` (DIM) |                  |

## No-Color Mode

Triggered by: `NO_COLOR` env var set, or `!process.stdout.isTTY` (piped output).

- No ANSI escape codes
- Priority shown as `[P1]`-`[P5]` text
- Type shown as `[bug]`/`[feat]`/`[chore]`/`[spike]` prefix
- Box-drawing replaced with ASCII: `+`, `-`, `|`
- Hierarchy conveyed through indentation and CAPS for headers

## Terminal Width

| Width       | Behavior                                                           |
| ----------- | ------------------------------------------------------------------ |
| >= 120 cols | Full 5-column board                                                |
| 80-119 cols | 3 most relevant columns (prioritize: in_progress, sprint, backlog) |
| < 80 cols   | Stacked single-column list view                                    |

## TUI Keybindings

| Key         | Action                                   |
| ----------- | ---------------------------------------- |
| `j` / `↓`   | Move to next card                        |
| `k` / `↑`   | Move to previous card                    |
| `h` / `←`   | Move to previous column                  |
| `l` / `→`   | Move to next column                      |
| `Enter`     | Open card detail                         |
| `n`         | Pick next sprint card (/kanban next)     |
| `a`         | Add new card (prompts for title)         |
| `m`         | Move selected card (prompts for column)  |
| `d`         | Mark selected card done                  |
| `x`         | Delete selected card (with confirmation) |
| `p`         | Set priority (prompts 1-5)               |
| `?`         | Help overlay                             |
| `q` / `Esc` | Quit TUI                                 |

## Focus Indicators (TUI)

- Selected card: inverse video (card background becomes bright, text becomes dark)
- Selected column: column header gets underline decoration
- Prompt input: cursor visible, input area highlighted
