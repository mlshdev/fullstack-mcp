import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { pages, sources } from "../db/schema.js";
import { logger } from "../lib/logger.js";

export function registerGetPage(server: McpServer) {
  server.tool(
    "get_page",
    "Retrieve the full stored markdown content for a specific documentation page by URL or page ID.",
    {
      url: z.string().url().optional().describe("The URL of the page to retrieve"),
      pageId: z.string().uuid().optional().describe("The page ID to retrieve"),
    },
    async (args) => {
      try {
        if (!args.url && !args.pageId) {
          return {
            content: [
              { type: "text" as const, text: "Error: Either url or pageId must be provided." },
            ],
            isError: true,
          };
        }

        const db = getDb();

        const condition = args.pageId
          ? eq(pages.id, args.pageId)
          : eq(pages.url, args.url!);

        const [row] = await db
          .select({
            id: pages.id,
            url: pages.url,
            title: pages.title,
            markdown: pages.markdown,
            wordCount: pages.wordCount,
            sourceName: sources.name,
            updatedAt: pages.updatedAt,
          })
          .from(pages)
          .innerJoin(sources, eq(pages.sourceId, sources.id))
          .where(condition)
          .limit(1);

        if (!row) {
          return {
            content: [{ type: "text" as const, text: "Page not found." }],
          };
        }

        const header = `# ${row.title || "Untitled"}\n\nSource: ${row.sourceName} | URL: ${row.url} | Words: ${row.wordCount}\n\n---\n\n`;

        return {
          content: [
            {
              type: "text" as const,
              text: header + row.markdown,
            },
          ],
        };
      } catch (err) {
        logger.error("get_page failed", { error: String(err) });
        return {
          content: [{ type: "text" as const, text: `Error: ${String(err)}` }],
          isError: true,
        };
      }
    },
  );
}
