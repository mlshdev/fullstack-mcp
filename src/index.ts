import express from "express";
import { getEnv } from "./config/env.js";
import { setLogLevel, logger } from "./lib/logger.js";
import { runMigrations } from "./db/migrate.js";
import { closePool, getPool } from "./db/client.js";
import { getRedis, closeRedis } from "./redis/client.js";
import { createMcpServer } from "./mcp/server.js";
import { handleMcpRequest, handleMcpGet, handleMcpDelete, cleanupStaleSessions, getSessions } from "./mcp/transport.js";
import { authMiddleware } from "./auth/middleware.js";
import { rateLimitMiddleware } from "./auth/rate-limiter.js";
import { healthHandler } from "./health/handler.js";

const env = getEnv();
setLogLevel(env.LOG_LEVEL);

// Run migrations
await runMigrations(env.DATABASE_URL);

// Connect Redis
const redis = getRedis();
await redis.connect();
logger.info("Redis connected");

// Verify PG connection
const pool = getPool();
await pool.query("SELECT 1");
logger.info("PostgreSQL connected");

// Create Express app
const app = express();

// Health endpoint (no auth)
app.get("/health", healthHandler);

// MCP endpoints (with auth + rate limiting)
const mcpServer = createMcpServer();

app.post("/mcp", authMiddleware, rateLimitMiddleware, (req, res) => {
  handleMcpRequest(mcpServer, req, res).catch((err) => {
    logger.error("MCP POST error", { error: String(err) });
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  });
});

app.get("/mcp", authMiddleware, rateLimitMiddleware, (req, res) => {
  handleMcpGet(req, res).catch((err) => {
    logger.error("MCP GET error", { error: String(err) });
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  });
});

app.delete("/mcp", authMiddleware, rateLimitMiddleware, (req, res) => {
  handleMcpDelete(req, res).catch((err) => {
    logger.error("MCP DELETE error", { error: String(err) });
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  });
});

// Session cleanup interval
const cleanupInterval = setInterval(() => cleanupStaleSessions(), 5 * 60 * 1000);

// Start server
const server = app.listen(env.PORT, env.HOST, () => {
  logger.info(`MCP server listening on ${env.HOST}:${env.PORT}`);
});

// Graceful shutdown
async function shutdown(signal: string) {
  logger.info(`Received ${signal}, shutting down gracefully...`);

  clearInterval(cleanupInterval);

  // Close HTTP server (stop accepting new connections)
  server.close();

  // Close all MCP sessions
  const sessions = getSessions();
  for (const [sid, transport] of sessions) {
    try {
      await transport.close();
    } catch {
      logger.warn("Error closing session", { sessionId: sid });
    }
  }
  sessions.clear();

  // Close dependencies
  await closeRedis();
  await closePool();

  logger.info("Shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
