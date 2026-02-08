import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Request, Response } from "express";
import { logger } from "../lib/logger.js";

const sessions = new Map<string, StreamableHTTPServerTransport>();

export function getSessions() {
  return sessions;
}

export async function handleMcpRequest(server: McpServer, req: Request, res: Response) {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (sessionId && sessions.has(sessionId)) {
    const transport = sessions.get(sessionId)!;
    await transport.handleRequest(req, res);
    return;
  }

  // New session - create transport
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    onsessioninitialized: (sid) => {
      sessions.set(sid, transport);
      logger.info("MCP session created", { sessionId: sid });
    },
  });

  transport.onclose = () => {
    const sid = [...sessions.entries()].find(([, t]) => t === transport)?.[0];
    if (sid) {
      sessions.delete(sid);
      logger.info("MCP session closed", { sessionId: sid });
    }
  };

  await server.connect(transport);
  await transport.handleRequest(req, res);
}

export async function handleMcpGet(req: Request, res: Response) {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !sessions.has(sessionId)) {
    res.status(400).json({ error: "Invalid or missing session ID" });
    return;
  }
  const transport = sessions.get(sessionId)!;
  await transport.handleRequest(req, res);
}

export async function handleMcpDelete(req: Request, res: Response) {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !sessions.has(sessionId)) {
    res.status(400).json({ error: "Invalid or missing session ID" });
    return;
  }
  const transport = sessions.get(sessionId)!;
  await transport.handleRequest(req, res);
}

export function cleanupStaleSessions(_maxAgeMs: number = 30 * 60 * 1000) {
  // Sessions are cleaned up via transport.onclose when they disconnect.
  // This is a safety net to remove orphaned entries.
  const now = Date.now();
  for (const [sid, transport] of sessions) {
    // StreamableHTTPServerTransport doesn't expose last activity,
    // so we rely on the onclose handler. Just log session count.
    void now;
    void transport;
    void sid;
  }
  logger.debug("Session cleanup check", { activeSessions: sessions.size });
}
