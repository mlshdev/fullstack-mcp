import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { eq } from "drizzle-orm";
import { getEnv } from "../config/env.js";
import { getDb } from "../db/client.js";
import { sources, pages, pageChunks } from "../db/schema.js";
import { processHtml } from "./content-processor.js";
import { chunkMarkdown } from "./chunker.js";
import { embedTexts } from "./embeddings.js";
import { createJob, updateJob } from "./job-manager.js";
import { sha256 } from "../lib/hash.js";
import { logger } from "../lib/logger.js";

interface CrawlOptions {
  url: string;
  name: string;
  maxPages?: number;
  includePatterns?: string[];
  excludePatterns?: string[];
}

const MAX_RETRIES = 2;
const BROWSERLESS_RETRIES = 3;
const BROWSERLESS_RETRY_DELAY = 2000;

async function connectBrowser(): Promise<Browser> {
  const env = getEnv();
  for (let attempt = 0; attempt < BROWSERLESS_RETRIES; attempt++) {
    try {
      return await puppeteer.connect({
        browserWSEndpoint: env.BROWSERLESS_URL,
      });
    } catch (err) {
      if (attempt === BROWSERLESS_RETRIES - 1) throw err;
      logger.warn("Browserless connection failed, retrying", {
        attempt: attempt + 1,
        error: String(err),
      });
      await new Promise((r) => setTimeout(r, BROWSERLESS_RETRY_DELAY * (attempt + 1)));
    }
  }
  throw new Error("Failed to connect to browserless");
}

async function discoverUrls(
  page: Page,
  baseUrl: string,
  includePatterns?: string[],
  excludePatterns?: string[],
): Promise<string[]> {
  const base = new URL(baseUrl);

  const links = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("a[href]"))
      .map((a) => (a as HTMLAnchorElement).href)
      .filter(Boolean);
  });

  const seen = new Set<string>();
  const urls: string[] = [];

  for (const link of links) {
    try {
      const parsed = new URL(link);
      // Same origin and prefix
      if (parsed.origin !== base.origin) continue;
      if (!parsed.pathname.startsWith(base.pathname)) continue;

      // Remove fragment
      parsed.hash = "";
      const normalized = parsed.toString();

      if (seen.has(normalized)) continue;
      seen.add(normalized);

      // Apply include patterns
      if (includePatterns?.length) {
        const matches = includePatterns.some((p) => normalized.includes(p));
        if (!matches) continue;
      }

      // Apply exclude patterns
      if (excludePatterns?.length) {
        const excluded = excludePatterns.some((p) => normalized.includes(p));
        if (excluded) continue;
      }

      urls.push(normalized);
    } catch {
      // Invalid URL, skip
    }
  }

  return urls;
}

async function fetchPageHtml(browser: Browser, url: string, timeout: number): Promise<string> {
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: "networkidle2", timeout });
    return await page.content();
  } finally {
    await page.close();
  }
}

async function processPage(
  browser: Browser,
  url: string,
  sourceId: string,
  timeout: number,
): Promise<boolean> {
  const db = getDb();

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const html = await fetchPageHtml(browser, url, timeout);
      const processed = processHtml(html, url);

      if (!processed) {
        logger.warn("Readability failed to parse page", { url });
        return false;
      }

      const contentHash = sha256(processed.markdown);

      // Check for existing page with same hash (dedup)
      const [existing] = await db
        .select({ id: pages.id, contentHash: pages.contentHash })
        .from(pages)
        .where(eq(pages.url, url))
        .limit(1);

      if (existing && existing.contentHash === contentHash) {
        logger.debug("Page unchanged, skipping", { url });
        return true;
      }

      // Chunk content
      const chunks = chunkMarkdown(processed.markdown);

      // Generate embeddings for all chunks
      const chunkTexts = chunks.map((c) => c.content);
      const embeddings = chunkTexts.length > 0 ? await embedTexts(chunkTexts) : [];

      // Upsert page
      if (existing) {
        await db
          .update(pages)
          .set({
            title: processed.title,
            markdown: processed.markdown,
            contentHash,
            wordCount: processed.wordCount,
            updatedAt: new Date(),
          })
          .where(eq(pages.id, existing.id));

        // Delete old chunks
        await db.delete(pageChunks).where(eq(pageChunks.pageId, existing.id));

        // Insert new chunks
        if (chunks.length > 0) {
          await db.insert(pageChunks).values(
            chunks.map((chunk, i) => ({
              pageId: existing.id,
              chunkIndex: chunk.index,
              content: chunk.content,
              tokenCount: chunk.tokenCount,
              heading: chunk.heading,
              embedding: embeddings[i] ?? null,
            })),
          );
        }
      } else {
        const [newPage] = await db
          .insert(pages)
          .values({
            sourceId,
            url,
            title: processed.title,
            markdown: processed.markdown,
            contentHash,
            wordCount: processed.wordCount,
          })
          .returning({ id: pages.id });

        if (chunks.length > 0) {
          await db.insert(pageChunks).values(
            chunks.map((chunk, i) => ({
              pageId: newPage.id,
              chunkIndex: chunk.index,
              content: chunk.content,
              tokenCount: chunk.tokenCount,
              heading: chunk.heading,
              embedding: embeddings[i] ?? null,
            })),
          );
        }
      }

      logger.info("Page processed", {
        url,
        chunks: chunks.length,
        wordCount: processed.wordCount,
      });
      return true;
    } catch (err) {
      if (attempt < MAX_RETRIES) {
        logger.warn("Page processing failed, retrying", {
          url,
          attempt: attempt + 1,
          error: String(err),
        });
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      } else {
        logger.error("Page processing failed after retries", {
          url,
          error: String(err),
        });
        return false;
      }
    }
  }
  return false;
}

export async function startCrawl(options: CrawlOptions): Promise<string> {
  const db = getDb();
  const env = getEnv();
  const maxPages = options.maxPages ?? env.CRAWL_MAX_PAGES;
  const concurrency = env.CRAWL_CONCURRENCY;
  const timeout = env.CRAWL_PAGE_TIMEOUT;

  // Create or get source
  const [existing] = await db
    .select()
    .from(sources)
    .where(eq(sources.baseUrl, options.url))
    .limit(1);

  let sourceId: string;
  const jobId = sha256(`${options.url}:${Date.now()}`).slice(0, 16);

  if (existing) {
    // If already crawling, return the existing job
    if (existing.status === "crawling" && existing.jobId) {
      return existing.jobId;
    }

    sourceId = existing.id;
    await db
      .update(sources)
      .set({
        name: options.name,
        status: "crawling",
        jobId,
        updatedAt: new Date(),
      })
      .where(eq(sources.id, sourceId));
  } else {
    const [newSource] = await db
      .insert(sources)
      .values({
        name: options.name,
        baseUrl: options.url,
        status: "crawling",
        jobId,
      })
      .returning({ id: sources.id });
    sourceId = newSource.id;
  }

  // Create job tracking in Redis
  await createJob(jobId);

  // Start crawl in background (non-blocking)
  executeCrawl(sourceId, jobId, options, maxPages, concurrency, timeout).catch((err) => {
    logger.error("Crawl failed", { jobId, error: String(err) });
  });

  return jobId;
}

async function executeCrawl(
  sourceId: string,
  jobId: string,
  options: CrawlOptions,
  maxPages: number,
  concurrency: number,
  timeout: number,
) {
  const db = getDb();
  let browser: Browser | null = null;

  try {
    browser = await connectBrowser();
    await updateJob(jobId, { status: "crawling" });

    // Discover URLs from base page
    const discoveryPage = await browser.newPage();
    await discoveryPage.goto(options.url, { waitUntil: "networkidle2", timeout });

    const discoveredUrls = await discoverUrls(
      discoveryPage,
      options.url,
      options.includePatterns,
      options.excludePatterns,
    );
    await discoveryPage.close();

    // Include the base URL itself
    const allUrls = [options.url, ...discoveredUrls.filter((u) => u !== options.url)];
    const urlsToProcess = allUrls.slice(0, maxPages);

    await updateJob(jobId, {
      status: "processing",
      totalPages: urlsToProcess.length,
    });

    logger.info("Crawl started", {
      jobId,
      baseUrl: options.url,
      totalUrls: urlsToProcess.length,
    });

    // Process pages with concurrency control
    let processedCount = 0;
    let failedCount = 0;

    const queue = [...urlsToProcess];
    const inFlight = new Set<Promise<void>>();

    while (queue.length > 0 || inFlight.size > 0) {
      while (queue.length > 0 && inFlight.size < concurrency) {
        const url = queue.shift()!;
        const task = (async () => {
          const success = await processPage(browser!, url, sourceId, timeout);
          if (success) {
            processedCount++;
          } else {
            failedCount++;
          }
          await updateJob(jobId, {
            processedPages: processedCount,
            failedPages: failedCount,
          });
        })();

        const tracked = task.then(
          () => { inFlight.delete(tracked); },
          () => { inFlight.delete(tracked); },
        );
        inFlight.add(tracked);
      }

      if (inFlight.size > 0) {
        await Promise.race(inFlight);
      }
    }

    // Update source
    await db
      .update(sources)
      .set({
        status: "ready",
        pageCount: processedCount,
        updatedAt: new Date(),
      })
      .where(eq(sources.id, sourceId));

    await updateJob(jobId, { status: "completed" });
    logger.info("Crawl completed", { jobId, processedCount, failedCount });
  } catch (err) {
    await updateJob(jobId, {
      status: "failed",
      error: String(err),
    });
    await db
      .update(sources)
      .set({ status: "failed", updatedAt: new Date() })
      .where(eq(sources.id, sourceId));

    logger.error("Crawl execution failed", { jobId, error: String(err) });
  } finally {
    if (browser) {
      try {
        browser.disconnect();
      } catch {
        // Ignore disconnect errors
      }
    }
  }
}
