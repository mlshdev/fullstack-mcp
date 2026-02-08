CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE "api_keys" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" varchar(255) NOT NULL,
  "prefix" varchar(8) NOT NULL,
  "key_hash" varchar(64) NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "rate_limit_requests" integer,
  "rate_limit_window_seconds" integer,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "revoked_at" timestamp with time zone
);

CREATE UNIQUE INDEX "api_keys_key_hash_idx" ON "api_keys" USING btree ("key_hash");
CREATE INDEX "api_keys_prefix_idx" ON "api_keys" USING btree ("prefix");

CREATE TABLE "sources" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" varchar(255) NOT NULL,
  "base_url" text NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'pending',
  "job_id" varchar(64),
  "page_count" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "sources_base_url_idx" ON "sources" USING btree ("base_url");
CREATE INDEX "sources_name_idx" ON "sources" USING btree ("name");

CREATE TABLE "pages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "source_id" uuid NOT NULL REFERENCES "sources"("id") ON DELETE CASCADE,
  "url" text NOT NULL,
  "title" varchar(1000),
  "markdown" text NOT NULL,
  "content_hash" varchar(64) NOT NULL,
  "word_count" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "pages_url_idx" ON "pages" USING btree ("url");
CREATE INDEX "pages_source_id_idx" ON "pages" USING btree ("source_id");
CREATE INDEX "pages_content_hash_idx" ON "pages" USING btree ("content_hash");

CREATE TABLE "page_chunks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "page_id" uuid NOT NULL REFERENCES "pages"("id") ON DELETE CASCADE,
  "chunk_index" integer NOT NULL,
  "content" text NOT NULL,
  "token_count" integer NOT NULL,
  "heading" varchar(500),
  "embedding" vector(1536),
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX "page_chunks_page_id_idx" ON "page_chunks" USING btree ("page_id");
CREATE INDEX "page_chunks_embedding_idx" ON "page_chunks" USING hnsw ("embedding" vector_cosine_ops);
