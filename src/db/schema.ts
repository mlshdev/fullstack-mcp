import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
  uuid,
  varchar,
  index,
  uniqueIndex,
  customType,
} from "drizzle-orm/pg-core";

const vector = customType<{ data: number[]; driverParam: string }>({
  dataType() {
    return "vector(1536)";
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: unknown): number[] {
    const str = value as string;
    return str
      .slice(1, -1)
      .split(",")
      .map(Number);
  },
});

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 255 }).notNull(),
    prefix: varchar("prefix", { length: 8 }).notNull(),
    keyHash: varchar("key_hash", { length: 64 }).notNull(),
    isActive: boolean("is_active").notNull().default(true),
    rateLimitRequests: integer("rate_limit_requests"),
    rateLimitWindowSeconds: integer("rate_limit_window_seconds"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("api_keys_key_hash_idx").on(table.keyHash),
    index("api_keys_prefix_idx").on(table.prefix),
  ],
);

export const sources = pgTable(
  "sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 255 }).notNull(),
    baseUrl: text("base_url").notNull(),
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    jobId: varchar("job_id", { length: 64 }),
    pageCount: integer("page_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("sources_base_url_idx").on(table.baseUrl),
    index("sources_name_idx").on(table.name),
  ],
);

export const pages = pgTable(
  "pages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    title: varchar("title", { length: 1000 }),
    markdown: text("markdown").notNull(),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    wordCount: integer("word_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("pages_url_idx").on(table.url),
    index("pages_source_id_idx").on(table.sourceId),
    index("pages_content_hash_idx").on(table.contentHash),
  ],
);

export const pageChunks = pgTable(
  "page_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pageId: uuid("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    content: text("content").notNull(),
    tokenCount: integer("token_count").notNull(),
    heading: varchar("heading", { length: 500 }),
    embedding: vector("embedding"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("page_chunks_page_id_idx").on(table.pageId),
  ],
);
