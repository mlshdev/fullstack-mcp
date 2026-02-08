import type { Request, Response, NextFunction } from "express";
import { getRedis } from "../redis/client.js";
import { getEnv } from "../config/env.js";
import type { AuthenticatedKey } from "./middleware.js";

// Lua script for atomic token bucket rate limiting
// Returns [allowed (0/1), remaining, resetTime]
const TOKEN_BUCKET_SCRIPT = `
local key = KEYS[1]
local max_tokens = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

local data = redis.call('HMGET', key, 'tokens', 'last_refill')
local tokens = tonumber(data[1])
local last_refill = tonumber(data[2])

if tokens == nil then
  tokens = max_tokens
  last_refill = now
end

-- Refill tokens based on elapsed time
local elapsed = now - last_refill
local refill = math.floor(elapsed * max_tokens / window)
if refill > 0 then
  tokens = math.min(max_tokens, tokens + refill)
  last_refill = now
end

local allowed = 0
if tokens > 0 then
  tokens = tokens - 1
  allowed = 1
end

redis.call('HMSET', key, 'tokens', tokens, 'last_refill', last_refill)
redis.call('EXPIRE', key, window * 2)

local reset_time = last_refill + window
return {allowed, tokens, reset_time}
`;

const RATE_LIMIT_PREFIX = "ratelimit:";

export async function rateLimitMiddleware(req: Request, res: Response, next: NextFunction) {
  const apiKey = (req as Request & { apiKey?: AuthenticatedKey }).apiKey;
  if (!apiKey) {
    next();
    return;
  }

  const env = getEnv();
  const maxRequests = apiKey.rateLimitRequests ?? env.RATE_LIMIT_REQUESTS;
  const windowSeconds = apiKey.rateLimitWindowSeconds ?? env.RATE_LIMIT_WINDOW_SECONDS;
  const redis = getRedis();
  const key = RATE_LIMIT_PREFIX + apiKey.id;
  const now = Math.floor(Date.now() / 1000);

  const result = (await redis.eval(
    TOKEN_BUCKET_SCRIPT,
    1,
    key,
    maxRequests,
    windowSeconds,
    now,
  )) as [number, number, number];

  const [allowed, remaining, resetTime] = result;

  res.setHeader("X-RateLimit-Limit", maxRequests);
  res.setHeader("X-RateLimit-Remaining", remaining);
  res.setHeader("X-RateLimit-Reset", resetTime);

  if (!allowed) {
    const retryAfter = Math.max(1, resetTime - now);
    res.setHeader("Retry-After", retryAfter);
    res.status(429).json({ error: "Rate limit exceeded", retryAfter });
    return;
  }

  next();
}
