import { serve } from "bun";
import { resolve } from "path";
import { readFileSync } from "fs";
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
  getDb,
  getMeta,
  autoArchive,
} from "./db";
import { COLUMNS, type Column } from "./models/card";

const __dir = import.meta.dir;

function jsonRes(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function createFetchHandler() {
  return async function fetch(req: Request) {
    const url = new URL(req.url);
    const path = url.pathname;

    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    if (path === "/" || path === "/index.html") {
      const html = readFileSync(resolve(__dir, "public/index.html"), "utf-8");
      return new Response(html, { headers: { "Content-Type": "text/html" } });
    }

    // GET /api/board
    if (path === "/api/board" && req.method === "GET") {
      autoArchive();
      const db = getDb();
      const board: Record<string, any> = {
        project: process.cwd().split("/").pop() ?? "project",
        lastActive: getMeta(db, "last_active"),
        columns: {} as any,
      };
      for (const col of COLUMNS) {
        board.columns[col] = listCards({ column: col }).map((c) => ({
          ...c,
          decisions: getDecisions(c.id),
          files: getCardFiles(c.id),
          snapshots: getSnapshots(c.id),
        }));
      }
      return jsonRes(board);
    }

    // POST /api/cards
    if (path === "/api/cards" && req.method === "POST") {
      const body = await req.json();
      if (!body.title) return jsonRes({ error: "Title required" }, 400);
      const card = createCard(body.title, {
        type: body.type ?? "feature",
        priority: body.priority ?? 3,
        column: body.column ?? "backlog",
        description: body.description,
      });
      return jsonRes(card, 201);
    }

    // GET/PATCH/DELETE /api/cards/:id
    const cardMatch = path.match(/^\/api\/cards\/(.+)$/);
    if (cardMatch && req.method === "GET") {
      const card = resolveCard(cardMatch[1]);
      if (!card) return jsonRes({ error: "Not found" }, 404);
      return jsonRes({
        ...card,
        decisions: getDecisions(card.id),
        files: getCardFiles(card.id),
        snapshots: getSnapshots(card.id),
      });
    }

    if (cardMatch && req.method === "PATCH") {
      const card = resolveCard(cardMatch[1]);
      if (!card) return jsonRes({ error: "Not found" }, 404);
      const body = await req.json();
      const allowed = ["title", "description", "type", "priority", "column"];
      const updates: any = {};
      for (const key of allowed) {
        if (body[key] !== undefined) updates[key] = body[key];
      }
      updateCard(card.id, updates);
      return jsonRes({ ok: true });
    }

    if (cardMatch && req.method === "DELETE") {
      const card = resolveCard(cardMatch[1]);
      if (!card) return jsonRes({ error: "Not found" }, 404);
      deleteCard(card.id);
      return jsonRes({ ok: true });
    }

    // POST /api/cards/:id/move
    const moveMatch = path.match(/^\/api\/cards\/(.+)\/move$/);
    if (moveMatch && req.method === "POST") {
      const card = resolveCard(moveMatch[1]);
      if (!card) return jsonRes({ error: "Not found" }, 404);
      const body = await req.json();
      if (!COLUMNS.includes(body.column))
        return jsonRes({ error: "Invalid column" }, 400);
      moveCard(card.id, body.column as Column);
      return jsonRes({ ok: true });
    }

    // POST /api/cards/:id/decisions
    const decMatch = path.match(/^\/api\/cards\/(.+)\/decisions$/);
    if (decMatch && req.method === "POST") {
      const card = resolveCard(decMatch[1]);
      if (!card) return jsonRes({ error: "Not found" }, 404);
      const body = await req.json();
      if (!body.decision)
        return jsonRes({ error: "Decision text required" }, 400);
      const entry = addDecision(card.id, body.decision, body.reasoning);
      return jsonRes(entry, 201);
    }

    return jsonRes({ error: "Not found" }, 404);
  };
}

export function startServer(preferredPort?: number): { port: number } {
  const basePort =
    preferredPort ?? parseInt(process.env.KANBAN_PORT ?? "3333", 10);

  for (let port = basePort; port < basePort + 8; port++) {
    try {
      serve({ port, fetch: createFetchHandler() });
      console.log(
        `\x1b[38;5;81m◈\x1b[0m Kanban board running at \x1b[1mhttp://localhost:${port}\x1b[0m`,
      );
      console.log(`\x1b[2m  Press Ctrl+C to stop\x1b[0m`);
      return { port };
    } catch (e: any) {
      if (e?.code !== "EADDRINUSE" && !e?.message?.includes("port")) throw e;
      // Try next port
    }
  }

  throw new Error(
    `All ports ${basePort}-${basePort + 7} in use. Set KANBAN_PORT to a free port.`,
  );
}

// Direct execution
if (import.meta.main) {
  startServer();
}
