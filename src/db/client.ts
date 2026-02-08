import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { getEnv } from "../config/env.js";
import * as schema from "./schema.js";

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    const env = getEnv();
    pool = new pg.Pool({
      connectionString: env.DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  }
  return pool;
}

export function getDb() {
  return drizzle(getPool(), { schema });
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
