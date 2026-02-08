import { migrate } from "drizzle-orm/node-postgres/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { logger } from "../lib/logger.js";

export async function runMigrations(connectionString: string) {
  const client = new pg.Pool({ connectionString, max: 1 });

  // Ensure pgvector extension exists
  await client.query("CREATE EXTENSION IF NOT EXISTS vector");

  const db = drizzle(client);
  logger.info("Running database migrations...");

  await migrate(db, { migrationsFolder: "./drizzle" });

  logger.info("Migrations completed successfully");
  await client.end();
}

// Allow running directly
if (import.meta.main) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  runMigrations(url)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Migration failed:", err);
      process.exit(1);
    });
}
