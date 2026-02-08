import type { Request, Response, NextFunction } from "express";
import { eq, and } from "drizzle-orm";
import { sha256 } from "../lib/hash.js";
import { getDb } from "../db/client.js";
import { getRedis } from "../redis/client.js";
import { apiKeys } from "../db/schema.js";
import { logger } from "../lib/logger.js";

interface AuthenticatedKey {
  id: string;
  name: string;
  rateLimitRequests: number | null;
  rateLimitWindowSeconds: number | null;
}

const CACHE_TTL = 300; // 5 minutes
const CACHE_PREFIX = "auth:key:";

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return;
  }

  const token = authHeader.slice(7);
  const keyHash = sha256(token);

  try {
    const keyData = await lookupKey(keyHash);
    if (!keyData) {
      res.status(401).json({ error: "Invalid API key" });
      return;
    }

    // Attach key info to request for rate limiter
    (req as Request & { apiKey: AuthenticatedKey }).apiKey = keyData;
    next();
  } catch (err) {
    logger.error("Auth middleware error", { error: String(err) });
    res.status(500).json({ error: "Internal server error" });
  }
}

async function lookupKey(keyHash: string): Promise<AuthenticatedKey | null> {
  const redis = getRedis();
  const cacheKey = CACHE_PREFIX + keyHash;

  // Check cache
  const cached = await redis.get(cacheKey);
  if (cached) {
    if (cached === "invalid") return null;
    return JSON.parse(cached) as AuthenticatedKey;
  }

  // Query DB
  const db = getDb();
  const [row] = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      rateLimitRequests: apiKeys.rateLimitRequests,
      rateLimitWindowSeconds: apiKeys.rateLimitWindowSeconds,
    })
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, keyHash), eq(apiKeys.isActive, true)))
    .limit(1);

  if (!row) {
    await redis.set(cacheKey, "invalid", "EX", CACHE_TTL);
    return null;
  }

  const keyData: AuthenticatedKey = {
    id: row.id,
    name: row.name,
    rateLimitRequests: row.rateLimitRequests,
    rateLimitWindowSeconds: row.rateLimitWindowSeconds,
  };

  await redis.set(cacheKey, JSON.stringify(keyData), "EX", CACHE_TTL);
  return keyData;
}

export type { AuthenticatedKey };
