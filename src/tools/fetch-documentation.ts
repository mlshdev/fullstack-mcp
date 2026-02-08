import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { startCrawl } from "../services/crawler.js";
import { getJob } from "../services/job-manager.js";
import { logger } from "../lib/logger.js";

export function registerFetchDocumentation(server: McpServer) {
  server.tool(
    "fetch_documentation",
    "Crawl a URL and its sub-pages, convert to markdown, chunk and embed for search. Returns a job ID for tracking long crawls.",
    {
      url: z.string().url().describe("The base URL to start crawling from"),
      name: z.string().min(1).describe("A human-readable name for this documentation source"),
      maxPages: z
        .number()
        .int()
        .min(1)
        .max(500)
        .optional()
        .describe("Maximum number of pages to crawl (default: 100)"),
      includePatterns: z
        .array(z.string())
        .optional()
        .describe("URL substrings that must match for a page to be included"),
      excludePatterns: z
        .array(z.string())
        .optional()
        .describe("URL substrings that exclude a page from crawling"),
    },
    async (args) => {
      try {
        const jobId = await startCrawl({
          url: args.url,
          name: args.name,
          maxPages: args.maxPages,
          includePatterns: args.includePatterns,
          excludePatterns: args.excludePatterns,
        });

        // Get initial status
        const status = await getJob(jobId);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  jobId,
                  message: `Crawl started for "${args.name}" (${args.url})`,
                  status: status?.status ?? "pending",
                  totalPages: status?.totalPages ?? 0,
                  processedPages: status?.processedPages ?? 0,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        logger.error("fetch_documentation failed", { error: String(err) });
        return {
          content: [{ type: "text" as const, text: `Error: ${String(err)}` }],
          isError: true,
        };
      }
    },
  );
}
