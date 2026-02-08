import { randomBytes } from "crypto";
import { eq } from "drizzle-orm";
import { sha256 } from "../src/lib/hash.js";
import { apiKeys } from "../src/db/schema.js";
import { getDb, closePool } from "../src/db/client.js";

const COMMANDS = ["create", "list", "revoke", "rotate"] as const;
type Command = (typeof COMMANDS)[number];

function usage() {
  console.log(`Usage: bun scripts/manage-keys.ts <command> [options]

Commands:
  create --name <name> [--rate-limit <n>] [--window <seconds>]
  list
  revoke --id <key-id>
  rotate --id <key-id>
`);
  process.exit(1);
}

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = args[i + 1];
      if (value && !value.startsWith("--")) {
        result[key] = value;
        i++;
      } else {
        result[key] = "true";
      }
    }
  }
  return result;
}

function generateKey(): { raw: string; prefix: string; hash: string } {
  const raw = `mcp_${randomBytes(32).toString("hex")}`;
  const prefix = raw.slice(0, 8);
  const hash = sha256(raw);
  return { raw, prefix, hash };
}

async function createKey(name: string, rateLimit?: number, window?: number) {
  const db = getDb();
  const { raw, prefix, hash } = generateKey();

  await db.insert(apiKeys).values({
    name,
    prefix,
    keyHash: hash,
    rateLimitRequests: rateLimit ?? null,
    rateLimitWindowSeconds: window ?? null,
  });

  console.log(`API key created successfully:`);
  console.log(`  Name:   ${name}`);
  console.log(`  Prefix: ${prefix}`);
  console.log(`  Key:    ${raw}`);
  console.log(`\nSave this key now - it cannot be retrieved later.`);
}

async function listKeys() {
  const db = getDb();
  const rows = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      prefix: apiKeys.prefix,
      isActive: apiKeys.isActive,
      rateLimitRequests: apiKeys.rateLimitRequests,
      createdAt: apiKeys.createdAt,
      revokedAt: apiKeys.revokedAt,
    })
    .from(apiKeys)
    .orderBy(apiKeys.createdAt);

  if (rows.length === 0) {
    console.log("No API keys found.");
    return;
  }

  console.log("API Keys:");
  for (const row of rows) {
    const status = row.isActive ? "active" : "revoked";
    const rateLimit = row.rateLimitRequests ? `${row.rateLimitRequests} req/window` : "default";
    console.log(`  ${row.prefix}... | ${row.name} | ${status} | ${rateLimit} | ${row.id}`);
  }
}

async function revokeKey(id: string) {
  const db = getDb();
  const [updated] = await db
    .update(apiKeys)
    .set({ isActive: false, revokedAt: new Date() })
    .where(eq(apiKeys.id, id))
    .returning({ name: apiKeys.name });

  if (!updated) {
    console.error(`Key not found: ${id}`);
    process.exit(1);
  }
  console.log(`Key "${updated.name}" revoked successfully.`);
}

async function rotateKey(id: string) {
  const db = getDb();
  const [existing] = await db
    .select({ name: apiKeys.name })
    .from(apiKeys)
    .where(eq(apiKeys.id, id))
    .limit(1);

  if (!existing) {
    console.error(`Key not found: ${id}`);
    process.exit(1);
  }

  // Revoke old key
  await db
    .update(apiKeys)
    .set({ isActive: false, revokedAt: new Date() })
    .where(eq(apiKeys.id, id));

  // Create new key with same name
  const { raw, prefix, hash } = generateKey();
  await db.insert(apiKeys).values({
    name: existing.name,
    prefix,
    keyHash: hash,
  });

  console.log(`Key rotated for "${existing.name}":`);
  console.log(`  New prefix: ${prefix}`);
  console.log(`  New key:    ${raw}`);
  console.log(`\nSave this key now - it cannot be retrieved later.`);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || !COMMANDS.includes(command as Command)) {
    usage();
  }

  const opts = parseArgs(rest);

  try {
    switch (command as Command) {
      case "create": {
        if (!opts.name) {
          console.error("--name is required");
          process.exit(1);
        }
        await createKey(
          opts.name,
          opts["rate-limit"] ? parseInt(opts["rate-limit"]) : undefined,
          opts.window ? parseInt(opts.window) : undefined,
        );
        break;
      }
      case "list":
        await listKeys();
        break;
      case "revoke": {
        if (!opts.id) {
          console.error("--id is required");
          process.exit(1);
        }
        await revokeKey(opts.id);
        break;
      }
      case "rotate": {
        if (!opts.id) {
          console.error("--id is required");
          process.exit(1);
        }
        await rotateKey(opts.id);
        break;
      }
    }
  } finally {
    await closePool();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
