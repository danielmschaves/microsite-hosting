import { Pool, type QueryResultRow } from "pg";

// A single shared pool. In dev, Next.js hot-reload can re-evaluate modules, so
// we cache the pool on globalThis to avoid exhausting Postgres connections.
const globalForDb = globalThis as unknown as { _pgPool?: Pool };

export const pool: Pool =
  globalForDb._pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb._pgPool = pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await pool.query<T>(text, params as never[]);
  return res.rows;
}

export interface SiteRow {
  id: string;
  slug: string;
  owner_email: string;
  s3_prefix: string;
  index_key: string;
  content_type: string;
  size_bytes: number;
  page_count: number;
  ttl_preset: string;
  expires_at: Date;
  created_at: Date;
  deleted_at: Date | null;
  purged_at: Date | null;
}

// Idempotent schema creation. Runs on server startup (see instrumentation.ts)
// so the same code path works against local Postgres and Neon alike.
const SCHEMA_SQL = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS sites (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         TEXT NOT NULL UNIQUE,
  owner_email  TEXT NOT NULL,
  s3_prefix    TEXT NOT NULL,
  index_key    TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'text/html',
  size_bytes   BIGINT NOT NULL DEFAULT 0,
  ttl_preset   TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS sites_owner_idx ON sites (owner_email);
CREATE INDEX IF NOT EXISTS sites_expiry_idx ON sites (expires_at) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS site_viewers (
  site_id      UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  viewer_email TEXT NOT NULL,
  PRIMARY KEY (site_id, viewer_email)
);

-- Additive migrations (idempotent) -----------------------------------------
-- Trash/restore: deleted_at now means "in trash"; purged_at marks the point
-- where storage was actually deleted (site no longer restorable).
ALTER TABLE sites ADD COLUMN IF NOT EXISTS purged_at TIMESTAMPTZ;
-- Multi-page sites: how many HTML files the site contains.
ALTER TABLE sites ADD COLUMN IF NOT EXISTS page_count INTEGER NOT NULL DEFAULT 1;

-- First-party product analytics (no third-party SDK).
CREATE TABLE IF NOT EXISTS events (
  id         BIGSERIAL PRIMARY KEY,
  type       TEXT NOT NULL,
  site_id    UUID,
  actor      TEXT,
  meta       JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS events_site_idx ON events (site_id, type, created_at);
`;

export async function migrate(): Promise<void> {
  // Retry briefly: in docker-compose the app may race the DB despite healthchecks.
  const maxAttempts = 10;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await pool.query(SCHEMA_SQL);
      return;
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}
