import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sql, eq, desc } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { pageChunks, pages, sources } from "../db/schema.js";
import { embedSingle } from "../services/embeddings.js";
import { logger } from "../lib/logger.js";

export function registerSearchDocumentation(server: McpServer) {
  server.tool(
    "search_documentation",
    "Semantic vector search across stored documentation with full-text fallback. Returns relevant chunks with source context.",
    {
      query: z.string().min(1).describe("The search query"),
      sourceId: z.string().uuid().optional().describe("Filter results to a specific source"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .describe("Maximum number of results (default: 5)"),
      threshold: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe("Minimum similarity threshold for vector search (default: 0.3)"),
    },
    async (args) => {
      try {
        const limit = args.limit ?? 5;
        const threshold = args.threshold ?? 0.3;

        // Try vector search first
        let results = await vectorSearch(args.query, limit, threshold, args.sourceId);

        // Fallback to full-text if vector search returns too few results
        if (results.length < 2) {
          const textResults = await fullTextSearch(args.query, limit, args.sourceId);
          // Merge, dedup by chunk ID
          const seen = new Set(results.map((r) => r.chunkId));
          for (const r of textResults) {
            if (!seen.has(r.chunkId)) {
              results.push(r);
              seen.add(r.chunkId);
            }
          }
          results = results.slice(0, limit);
        }

        if (results.length === 0) {
          return {
            content: [{ type: "text" as const, text: "No results found for your query." }],
          };
        }

        const output = results.map((r) => ({
          source: r.sourceName,
          pageTitle: r.pageTitle,
          pageUrl: r.pageUrl,
          heading: r.heading,
          similarity: r.similarity,
          content: r.content,
        }));

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(output, null, 2),
            },
          ],
        };
      } catch (err) {
        logger.error("search_documentation failed", { error: String(err) });
        return {
          content: [{ type: "text" as const, text: `Error: ${String(err)}` }],
          isError: true,
        };
      }
    },
  );
}

interface SearchResult {
  chunkId: string;
  content: string;
  heading: string | null;
  similarity: number;
  pageTitle: string | null;
  pageUrl: string;
  sourceName: string;
}

async function vectorSearch(
  query: string,
  limit: number,
  threshold: number,
  sourceId?: string,
): Promise<SearchResult[]> {
  const embedding = await embedSingle(query);
  const db = getDb();

  const vectorStr = `[${embedding.join(",")}]`;

  const conditions = sourceId
    ? sql`${pages.sourceId} = ${sourceId} AND (1 - (${pageChunks.embedding} <=> ${vectorStr}::vector)) >= ${threshold}`
    : sql`(1 - (${pageChunks.embedding} <=> ${vectorStr}::vector)) >= ${threshold}`;

  const rows = await db
    .select({
      chunkId: pageChunks.id,
      content: pageChunks.content,
      heading: pageChunks.heading,
      similarity: sql<number>`1 - (${pageChunks.embedding} <=> ${vectorStr}::vector)`,
      pageTitle: pages.title,
      pageUrl: pages.url,
      sourceName: sources.name,
    })
    .from(pageChunks)
    .innerJoin(pages, eq(pageChunks.pageId, pages.id))
    .innerJoin(sources, eq(pages.sourceId, sources.id))
    .where(conditions)
    .orderBy(sql`${pageChunks.embedding} <=> ${vectorStr}::vector`)
    .limit(limit);

  return rows.map((r) => ({
    chunkId: r.chunkId,
    content: r.content,
    heading: r.heading,
    similarity: Math.round(Number(r.similarity) * 1000) / 1000,
    pageTitle: r.pageTitle,
    pageUrl: r.pageUrl,
    sourceName: r.sourceName,
  }));
}

async function fullTextSearch(
  query: string,
  limit: number,
  sourceId?: string,
): Promise<SearchResult[]> {
  const db = getDb();

  const tsQuery = query
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.replace(/[^a-zA-Z0-9]/g, ""))
    .filter(Boolean)
    .join(" & ");

  if (!tsQuery) return [];

  const baseCondition = sql`to_tsvector('english', ${pageChunks.content}) @@ to_tsquery('english', ${tsQuery})`;
  const conditions = sourceId
    ? sql`${baseCondition} AND ${pages.sourceId} = ${sourceId}`
    : baseCondition;

  const rows = await db
    .select({
      chunkId: pageChunks.id,
      content: pageChunks.content,
      heading: pageChunks.heading,
      rank: sql<number>`ts_rank(to_tsvector('english', ${pageChunks.content}), to_tsquery('english', ${tsQuery}))`,
      pageTitle: pages.title,
      pageUrl: pages.url,
      sourceName: sources.name,
    })
    .from(pageChunks)
    .innerJoin(pages, eq(pageChunks.pageId, pages.id))
    .innerJoin(sources, eq(pages.sourceId, sources.id))
    .where(conditions)
    .orderBy(desc(sql`ts_rank(to_tsvector('english', ${pageChunks.content}), to_tsquery('english', ${tsQuery}))`))
    .limit(limit);

  return rows.map((r) => ({
    chunkId: r.chunkId,
    content: r.content,
    heading: r.heading,
    similarity: Math.round(Number(r.rank) * 1000) / 1000,
    pageTitle: r.pageTitle,
    pageUrl: r.pageUrl,
    sourceName: r.sourceName,
  }));
}
