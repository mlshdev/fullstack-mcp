# Stage 1: Install dependencies
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production=false

# Stage 2: Typecheck
FROM deps AS build
COPY tsconfig.json ./
COPY src/ ./src/
COPY scripts/ ./scripts/
COPY drizzle.config.ts ./
RUN bun run typecheck

# Stage 3: Production
FROM oven/bun:1-slim AS production
WORKDIR /app

# Install production deps only
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Copy application code
COPY src/ ./src/
COPY scripts/ ./scripts/
COPY drizzle/ ./drizzle/
COPY drizzle.config.ts ./

# Create non-root user
RUN groupadd -g 1001 mcp && \
    useradd -u 1001 -g mcp -s /bin/sh -m mcp && \
    chown -R mcp:mcp /app
USER mcp

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "const r = await fetch('http://localhost:3000/health'); process.exit(r.ok ? 0 : 1)"

CMD ["bun", "run", "src/index.ts"]
