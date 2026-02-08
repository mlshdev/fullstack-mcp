export interface Chunk {
  content: string;
  heading: string | null;
  tokenCount: number;
  index: number;
}

const TARGET_TOKENS = 500;
const MAX_TOKENS = 800;

// Rough token estimation: ~4 chars per token for English text
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function chunkMarkdown(markdown: string): Chunk[] {
  const lines = markdown.split("\n");
  const chunks: Chunk[] = [];
  let currentLines: string[] = [];
  let currentHeading: string | null = null;
  let currentTokens = 0;

  function flushChunk() {
    if (currentLines.length === 0) return;
    const content = currentLines.join("\n").trim();
    if (!content) return;

    chunks.push({
      content,
      heading: currentHeading,
      tokenCount: estimateTokens(content),
      index: chunks.length,
    });
    currentLines = [];
    currentTokens = 0;
  }

  for (const line of lines) {
    const isHeading = /^#{1,6}\s/.test(line);
    const lineTokens = estimateTokens(line);

    if (isHeading) {
      // Start a new chunk on heading boundaries if current chunk has content
      if (currentTokens > 0) {
        flushChunk();
      }
      currentHeading = line.replace(/^#+\s*/, "").trim();
      currentLines.push(line);
      currentTokens += lineTokens;
      continue;
    }

    // Check if adding this line would exceed max tokens
    if (currentTokens + lineTokens > MAX_TOKENS && currentTokens > 0) {
      flushChunk();
    }

    currentLines.push(line);
    currentTokens += lineTokens;

    // If we've hit the target and the next natural break seems good, flush
    if (currentTokens >= TARGET_TOKENS && line === "") {
      flushChunk();
    }
  }

  flushChunk();
  return chunks;
}
