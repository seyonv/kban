// Force color on — most terminals support it. Only disable with NO_COLOR.
const isColor = !process.env.NO_COLOR;

const esc = (code: string) => (isColor ? `\x1b[${code}m` : "");

export const reset = esc("0");
export const bold = esc("1");
export const dim = esc("2");
export const italic = esc("3");
export const underline = esc("4");
export const inverse = esc("7");

function fg(code: number): string {
  if (!isColor) return "";
  return `\x1b[38;5;${code}m`;
}

function bg(code: number): string {
  if (!isColor) return "";
  return `\x1b[48;5;${code}m`;
}

// Priority colors — vivid, instantly scannable
export const priorityColor: Record<number, string> = {
  1: fg(196), // bright red
  2: fg(208), // orange
  3: fg(75), // soft blue
  4: fg(249), // light gray
  5: fg(243), // mid gray
};

export const priorityBg: Record<number, string> = {
  1: `${bg(196)}${fg(231)}`, // white on red
  2: `${bg(208)}${fg(232)}`, // black on orange
  3: `${bg(75)}${fg(231)}`, // white on blue
  4: `${bg(249)}${fg(232)}`, // black on gray
  5: `${bg(243)}${fg(231)}`, // white on dark gray
};

export const priorityLabel: Record<number, string> = {
  1: "CRIT",
  2: "HIGH",
  3: "MED",
  4: "LOW",
  5: "MIN",
};

// Column colors
export const columnColor: Record<string, string> = {
  backlog: fg(246),
  sprint: fg(81), // bright cyan
  in_progress: fg(114), // green
  review: fg(220), // gold
  done: fg(242), // muted gray
};

export const columnEmoji: Record<string, string> = {
  backlog: "📋",
  sprint: "🎯",
  in_progress: "🔨",
  review: "👀",
  done: "✅",
};

// Semantic
export const green = fg(114);
export const red = fg(196);
export const yellow = fg(220);
export const cyan = fg(81);
export const gray = fg(246);
export const dimGray = fg(242);
export const white = fg(255);
export const orange = fg(208);

// Card type config
export const typeConfig: Record<string, { icon: string; color: string }> = {
  feature: { icon: "◈", color: fg(81) },
  bug: { icon: "⚠", color: fg(196) },
  chore: { icon: "⚙", color: fg(246) },
  spike: { icon: "◆", color: fg(141) },
};

// Box-drawing — always use Unicode (it's 2026)
export const box = { tl: "╭", tr: "╮", bl: "╰", br: "╯", h: "─", v: "│" };
export const cardBox = { tl: "┌", tr: "┐", bl: "└", br: "┘", h: "─", v: "│" };
export const heavyH = "━";
export const dot = "·";
export const bullet = "•";
export const arrow = "→";

export function termWidth(): number {
  return process.stdout.columns ?? 100;
}

// Strip ANSI for measuring visible length
export function visLen(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

export function padR(s: string, w: number): string {
  const pad = Math.max(0, w - visLen(s));
  return s + " ".repeat(pad);
}

export function padC(s: string, w: number): string {
  const total = Math.max(0, w - visLen(s));
  const left = Math.floor(total / 2);
  return " ".repeat(left) + s + " ".repeat(total - left);
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}
