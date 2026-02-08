import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getDb } from "../db/client.js";
import { sources } from "../db/schema.js";
import { getJob } from "../services/job-manager.js";
import { logger } from "../lib/logger.js";

export function registerListSources(server: McpServer) {
  server.tool(
    "list_sources",
    "List all documentation sources with their status, page counts, and crawl progress.",
    {},
    async () => {
      try {
        const db = getDb();
        const rows = await db
          .select({
            id: sources.id,
            name: sources.name,
            baseUrl: sources.baseUrl,
            status: sources.status,
            jobId: sources.jobId,
            pageCount: sources.pageCount,
            createdAt: sources.createdAt,
            updatedAt: sources.updatedAt,
          })
          .from(sources)
          .orderBy(sources.name);

        if (rows.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No documentation sources found. Use fetch_documentation to add one.",
              },
            ],
          };
        }

        const results = await Promise.all(
          rows.map(async (row) => {
            const result: Record<string, unknown> = {
              id: row.id,
              name: row.name,
              baseUrl: row.baseUrl,
              status: row.status,
              pageCount: row.pageCount,
              createdAt: row.createdAt,
              updatedAt: row.updatedAt,
            };

            // Include job progress for active crawls
            if (row.jobId && row.status === "crawling") {
              const job = await getJob(row.jobId);
              if (job) {
                result.crawlProgress = {
                  totalPages: job.totalPages,
                  processedPages: job.processedPages,
                  failedPages: job.failedPages,
                };
              }
            }

            return result;
          }),
        );

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(results, null, 2),
            },
          ],
        };
      } catch (err) {
        logger.error("list_sources failed", { error: String(err) });
        return {
          content: [{ type: "text" as const, text: `Error: ${String(err)}` }],
          isError: true,
        };
      }
    },
  );
}
