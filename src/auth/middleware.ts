import type { Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "crypto";
import { getEnv } from "../config/env.js";
import { logger } from "../lib/logger.js";

interface AuthenticatedKey {
  id: string;
  name: string;
  rateLimitRequests: number | null;
  rateLimitWindowSeconds: number | null;
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const env = getEnv();
    const expected = env.MCP_API_KEY;

    // Constant-time comparison to prevent timing attacks
    const tokenBuf = Buffer.from(token);
    const expectedBuf = Buffer.from(expected);
    if (tokenBuf.length !== expectedBuf.length || !timingSafeEqual(tokenBuf, expectedBuf)) {
      res.status(401).json({ error: "Invalid API key" });
      return;
    }

    // Attach key info to request for rate limiter
    const keyData: AuthenticatedKey = {
      id: "env",
      name: "env",
      rateLimitRequests: null,
      rateLimitWindowSeconds: null,
    };
    (req as Request & { apiKey: AuthenticatedKey }).apiKey = keyData;
    next();
  } catch (err) {
    logger.error("Auth middleware error", { error: String(err) });
    res.status(500).json({ error: "Internal server error" });
  }
}

export type { AuthenticatedKey };
