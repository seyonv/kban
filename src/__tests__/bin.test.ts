import { describe, test, expect } from "bun:test";

// ── Module exports ──────────────────────────────

describe("module exports", () => {
  test("cli.ts exports runCommand function", async () => {
    const mod = await import("../cli");
    expect(typeof mod.runCommand).toBe("function");
  });

  test("server.ts exports startServer function", async () => {
    const mod = await import("../server");
    expect(typeof mod.startServer).toBe("function");
  });

  test("sync.ts exports analyzeProject and createCardsFromAnalysis", async () => {
    const mod = await import("../sync");
    expect(typeof mod.analyzeProject).toBe("function");
    expect(typeof mod.createCardsFromAnalysis).toBe("function");
  });

  test("db.ts exports all CRUD functions", async () => {
    const mod = await import("../db");
    expect(typeof mod.createCard).toBe("function");
    expect(typeof mod.resolveCard).toBe("function");
    expect(typeof mod.updateCard).toBe("function");
    expect(typeof mod.moveCard).toBe("function");
    expect(typeof mod.deleteCard).toBe("function");
    expect(typeof mod.listCards).toBe("function");
    expect(typeof mod.addDecision).toBe("function");
    expect(typeof mod.getDecisions).toBe("function");
    expect(typeof mod.addSnapshot).toBe("function");
    expect(typeof mod.getSnapshots).toBe("function");
    expect(typeof mod.addCardFile).toBe("function");
    expect(typeof mod.getCardFiles).toBe("function");
    expect(typeof mod.closeDb).toBe("function");
    expect(typeof mod.autoArchive).toBe("function");
  });
});

// ── CLI runCommand ──────────────────────────────

describe("runCommand", () => {
  test("help command outputs kban help text", async () => {
    const { runCommand } = await import("../cli");
    const original = console.log;
    let output = "";
    console.log = (...args: any[]) => {
      output += args.join(" ") + "\n";
    };
    try {
      runCommand("help", []);
    } finally {
      console.log = original;
    }
    expect(output).toContain("kban");
    expect(output).toContain("init");
    expect(output).toContain("web");
    expect(output).toContain("view");
    expect(output).toContain("add");
    expect(output).toContain("move");
    expect(output).toContain("done");
    expect(output).toContain("context");
  });

  test("view command runs without error", async () => {
    const { runCommand } = await import("../cli");
    const original = console.log;
    let output = "";
    console.log = (...args: any[]) => {
      output += args.join(" ") + "\n";
    };
    try {
      runCommand("view", []);
    } finally {
      console.log = original;
    }
    expect(output).toContain("KANBAN");
  });

  test("context command produces markdown", async () => {
    const { runCommand } = await import("../cli");
    const original = console.log;
    let output = "";
    console.log = (...args: any[]) => {
      output += args.join(" ") + "\n";
    };
    try {
      runCommand("context", []);
    } finally {
      console.log = original;
    }
    expect(output).toContain("# Board Context");
  });
});

// ── Models ──────────────────────────────────────

describe("card model constants", () => {
  test("COLUMNS has 5 entries in correct order", async () => {
    const { COLUMNS } = await import("../models/card");
    expect(COLUMNS).toEqual([
      "backlog",
      "sprint",
      "in_progress",
      "review",
      "done",
    ]);
  });

  test("COLUMN_LABELS maps all columns", async () => {
    const { COLUMNS, COLUMN_LABELS } = await import("../models/card");
    for (const col of COLUMNS) {
      expect(COLUMN_LABELS[col]).toBeTruthy();
    }
  });
});

// ── Render utilities ────────────────────────────

describe("render/theme utilities", () => {
  test("visLen strips ANSI codes", async () => {
    const { visLen, bold, reset } = await import("../render/theme");
    expect(visLen(`${bold}hello${reset}`)).toBe(5);
    expect(visLen("plain")).toBe(5);
  });

  test("padR pads to target width", async () => {
    const { padR, visLen } = await import("../render/theme");
    const padded = padR("hi", 10);
    expect(visLen(padded)).toBe(10);
  });

  test("truncate shortens long strings", async () => {
    const { truncate } = await import("../render/theme");
    expect(truncate("hello world", 8)).toBe("hello w…");
    expect(truncate("short", 10)).toBe("short");
  });

  test("termWidth returns a number", async () => {
    const { termWidth } = await import("../render/theme");
    expect(typeof termWidth()).toBe("number");
    expect(termWidth()).toBeGreaterThan(0);
  });
});

// ── Spinner utilities ───────────────────────────

describe("render/spinner utilities", () => {
  test("createSpinner returns control object", async () => {
    const { createSpinner } = await import("../render/spinner");
    const spinner = createSpinner("test");
    expect(typeof spinner.update).toBe("function");
    expect(typeof spinner.succeed).toBe("function");
    expect(typeof spinner.fail).toBe("function");
    expect(typeof spinner.stop).toBe("function");
    spinner.stop();
  });

  test("printBanner does not throw", async () => {
    const { printBanner } = await import("../render/spinner");
    const original = console.log;
    console.log = () => {};
    try {
      printBanner("0.1.0");
    } finally {
      console.log = original;
    }
  });
});

// ── Dashboard module ────────────────────────────

describe("dashboard", () => {
  test("scanProjects export exists and returns array", async () => {
    const { scanProjects } = await import("../dashboard");
    expect(typeof scanProjects).toBe("function");
    const result = scanProjects();
    expect(Array.isArray(result)).toBe(true);
  });

  test("runDashboard export exists", async () => {
    const { runDashboard } = await import("../dashboard");
    expect(typeof runDashboard).toBe("function");
  });
});

// ── New CLI commands ────────────────────────────

describe("new CLI commands", () => {
  test("help includes sync, dashboard, log-prompt, hook-setup", async () => {
    const { runCommand } = await import("../cli");
    const original = console.log;
    let output = "";
    console.log = (...args: any[]) => {
      output += args.join(" ") + "\n";
    };
    try {
      runCommand("help", []);
    } finally {
      console.log = original;
    }
    expect(output).toContain("sync");
    expect(output).toContain("dashboard");
    expect(output).toContain("log-prompt");
    expect(output).toContain("hook-setup");
  });
});
