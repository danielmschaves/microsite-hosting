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

/** Query function bound to a single connection (for transactions). */
export type QueryFn = <T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
) => Promise<T[]>;

/**
 * Run `fn` inside a BEGIN/COMMIT block on one pooled connection, rolling
 * back on any throw. Use the provided query function for every statement
 * that must be atomic.
 */
export async function withTransaction<T>(
  fn: (tx: QueryFn) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  const tx: QueryFn = async (text, params = []) => {
    const res = await client.query(text, params as never[]);
    return res.rows;
  };
  try {
    await client.query("BEGIN");
    const result = await fn(tx);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export interface WorkspaceRow {
  id: string;
  name: string;
  created_by: string;
  plan: string;
  max_ttl_preset: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: string | null;
  seats: number;
  created_at: Date;
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
  workspace_id: string | null;
  visibility: string; // 'only_me' | 'allowlist' | 'team' | 'public'
  current_version: number;
  notified_48h_at: Date | null;
  notified_2h_at: Date | null;
}

export interface SiteVersionRow {
  id: string;
  site_id: string;
  version: number;
  s3_prefix: string;
  index_key: string;
  size_bytes: number;
  page_count: number;
  created_by: string;
  created_at: Date;
}

export interface ApiTokenRow {
  id: string;
  owner_email: string;
  name: string;
  token_hash: string;
  token_prefix: string;
  created_at: Date;
  last_used_at: Date | null;
  revoked_at: Date | null;
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

-- Teams / workspaces (v1.0) -------------------------------------------------
CREATE TABLE IF NOT EXISTS workspaces (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   TEXT NOT NULL,
  created_by             TEXT NOT NULL,
  plan                   TEXT NOT NULL DEFAULT 'free',
  max_ttl_preset         TEXT,
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT,
  subscription_status    TEXT,
  seats                  INTEGER NOT NULL DEFAULT 0,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'member',
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, email)
);
CREATE INDEX IF NOT EXISTS workspace_members_email_idx ON workspace_members (email);

CREATE TABLE IF NOT EXISTS workspace_invites (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'member',
  token        TEXT NOT NULL UNIQUE,
  invited_by   TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  accepted_at  TIMESTAMPTZ
);

ALTER TABLE events ADD COLUMN IF NOT EXISTS workspace_id UUID;
CREATE INDEX IF NOT EXISTS events_workspace_idx ON events (workspace_id, created_at);

-- Team sites (v1.0 phase 2): NULL workspace_id = personal site. 'allowlist'
-- default matches pre-existing semantics (owner + site_viewers) exactly.
ALTER TABLE sites ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id);
ALTER TABLE sites ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'allowlist';
CREATE INDEX IF NOT EXISTS sites_workspace_idx ON sites (workspace_id) WHERE deleted_at IS NULL;

-- Pre-signed browser->S3 uploads (v1.0 phase 4). The prefix becomes the
-- site's final prefix at completion — no copy step. Stale incomplete rows are
-- purged by the cleanup cron.
CREATE TABLE IF NOT EXISTS pending_uploads (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_email  TEXT NOT NULL,
  workspace_id UUID,
  s3_prefix    TEXT NOT NULL,
  files        JSONB NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS pending_uploads_stale_idx ON pending_uploads (created_at) WHERE completed_at IS NULL;

-- Versioning (v1.0): every publish (including the first) records a version.
-- The sites row is the live pointer — s3_prefix/index_key/size_bytes/
-- page_count always describe the *current* version; rollback flips the
-- pointer to an older version's values without moving any bytes.
CREATE TABLE IF NOT EXISTS site_versions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id     UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  version     INTEGER NOT NULL,
  s3_prefix   TEXT NOT NULL,
  index_key   TEXT NOT NULL,
  size_bytes  BIGINT NOT NULL,
  page_count  INTEGER NOT NULL,
  created_by  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (site_id, version)
);
ALTER TABLE sites ADD COLUMN IF NOT EXISTS current_version INTEGER NOT NULL DEFAULT 1;

-- Personal access tokens for the REST v1 API. Only a sha256 hash of the
-- secret is stored; token_prefix is the display stub ("mb_live_ab12").
CREATE TABLE IF NOT EXISTS api_tokens (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_email  TEXT NOT NULL,
  name         TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS api_tokens_owner_idx ON api_tokens (owner_email);

-- Expiry notifications: double-send markers, cleared when the TTL is
-- extended or the site is restored.
ALTER TABLE sites ADD COLUMN IF NOT EXISTS notified_48h_at TIMESTAMPTZ;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS notified_2h_at TIMESTAMPTZ;
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
