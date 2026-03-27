import { describe, test, expect } from "bun:test";

describe("bin.ts exports and routing", () => {
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

  test("runCommand('help') does not throw", async () => {
    const { runCommand } = await import("../cli");
    // Capture stdout
    const originalLog = console.log;
    let output = "";
    console.log = (...args: any[]) => {
      output += args.join(" ") + "\n";
    };
    try {
      runCommand("help", []);
    } finally {
      console.log = originalLog;
    }
    expect(output).toContain("kban");
    expect(output).toContain("init");
    expect(output).toContain("web");
  });
});
