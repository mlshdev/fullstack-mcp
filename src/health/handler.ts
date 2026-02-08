import type { Request, Response } from "express";
import { getPool } from "../db/client.js";
import { getRedis } from "../redis/client.js";
import { getEnv } from "../config/env.js";
import { logger } from "../lib/logger.js";

interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  services: {
    postgres: ServiceStatus;
    redis: ServiceStatus;
    browserless: ServiceStatus;
  };
  uptime: number;
}

interface ServiceStatus {
  status: "up" | "down";
  latencyMs?: number;
  error?: string;
}

async function checkPostgres(): Promise<ServiceStatus> {
  const start = Date.now();
  try {
    const pool = getPool();
    await pool.query("SELECT 1");
    return { status: "up", latencyMs: Date.now() - start };
  } catch (err) {
    return { status: "down", error: String(err), latencyMs: Date.now() - start };
  }
}

async function checkRedis(): Promise<ServiceStatus> {
  const start = Date.now();
  try {
    const redis = getRedis();
    await redis.ping();
    return { status: "up", latencyMs: Date.now() - start };
  } catch (err) {
    return { status: "down", error: String(err), latencyMs: Date.now() - start };
  }
}

async function checkBrowserless(): Promise<ServiceStatus> {
  const start = Date.now();
  try {
    const env = getEnv();
    // Convert ws:// to http:// for health check
    const httpUrl = env.BROWSERLESS_URL.replace(/^ws/, "http");
    const res = await fetch(`${httpUrl}/json/version`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { status: "up", latencyMs: Date.now() - start };
  } catch (err) {
    return { status: "down", error: String(err), latencyMs: Date.now() - start };
  }
}

const startTime = Date.now();

export async function healthHandler(_req: Request, res: Response) {
  try {
    const [postgres, redis, browserless] = await Promise.all([
      checkPostgres(),
      checkRedis(),
      checkBrowserless(),
    ]);

    const allUp = postgres.status === "up" && redis.status === "up" && browserless.status === "up";
    const allDown =
      postgres.status === "down" && redis.status === "down" && browserless.status === "down";

    const health: HealthStatus = {
      status: allDown ? "unhealthy" : allUp ? "healthy" : "degraded",
      services: { postgres, redis, browserless },
      uptime: Math.floor((Date.now() - startTime) / 1000),
    };

    const statusCode = health.status === "unhealthy" ? 503 : 200;
    res.status(statusCode).json(health);
  } catch (err) {
    logger.error("Health check failed", { error: String(err) });
    res.status(503).json({ status: "unhealthy", error: "Health check failed" });
  }
}
