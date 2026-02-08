import OpenAI from "openai";
import { getEnv } from "../config/env.js";
import { logger } from "../lib/logger.js";

const MODEL = "openai/text-embedding-3-small";
const MAX_BATCH_SIZE = 100;
const MAX_RETRIES = 3;
const BASE_DELAY = 1000;

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    const env = getEnv();
    client = new OpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: env.OPENROUTER_API_KEY,
    });
  }
  return client;
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const results: number[][] = [];

  // Process in batches
  for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
    const batch = texts.slice(i, i + MAX_BATCH_SIZE);
    const embeddings = await embedBatchWithRetry(batch);
    results.push(...embeddings);
  }

  return results;
}

async function embedBatchWithRetry(texts: string[]): Promise<number[][]> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const openai = getClient();
      const response = await openai.embeddings.create({
        model: MODEL,
        input: texts,
      });

      // Sort by index to maintain order
      return response.data
        .sort((a, b) => a.index - b.index)
        .map((d) => d.embedding);
    } catch (err) {
      const isRateLimit = err instanceof OpenAI.RateLimitError;
      const isRetryable = isRateLimit || err instanceof OpenAI.APIConnectionError;

      if (!isRetryable || attempt === MAX_RETRIES - 1) {
        throw err;
      }

      const delay = isRateLimit
        ? BASE_DELAY * Math.pow(2, attempt + 1) // Longer backoff for rate limits
        : BASE_DELAY * Math.pow(2, attempt);

      logger.warn("Embedding request failed, retrying", {
        attempt: attempt + 1,
        delay,
        error: String(err),
      });

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw new Error("Embedding failed after all retries");
}

export async function embedSingle(text: string): Promise<number[]> {
  const [embedding] = await embedTexts([text]);
  return embedding;
}
