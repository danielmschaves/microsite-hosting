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

export type PublishMode = "direct" | "confirm" | "approval";

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
  publish_mode: PublishMode;
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
  production_deployment_id: string | null;
  primary_host: string | null;
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

// Agent Gateway (PRD v2.0, R0/R1) -------------------------------------------

export type VersionSource = "upload" | "agent" | "github" | "template" | "rollback";
export type ActorType = "human" | "agent";

export interface VersionRow {
  id: string;
  site_id: string;
  number: number;
  storage_key: string;
  content_digest: string | null;
  source: VersionSource;
  summary: string | null;
  author_email: string;
  actor_type: ActorType;
  created_at: Date;
}

export type DeploymentTarget = "preview" | "production";
export type DeploymentStatus =
  | "queued"
  | "building"
  | "ready"
  | "published"
  | "failed"
  | "canceled";
export type DeploymentAccessMode = "password" | "organization" | "hybrid" | "inherit";

export interface DeploymentRow {
  id: string;
  site_id: string;
  version_id: string;
  changeset_id: string | null;
  target: DeploymentTarget;
  status: DeploymentStatus;
  url: string | null;
  access_mode: DeploymentAccessMode;
  access_password_hash: string | null;
  created_by: string;
  actor_type: ActorType;
  agent_client_id: string | null;
  build_started_at: Date | null;
  build_finished_at: Date | null;
  error: Record<string, unknown> | null;
  published_at: Date | null;
  created_at: Date;
}

export type AgentClientKind = "claude-code" | "codex" | "cursor" | "other";

export interface AgentClientRow {
  id: string;
  workspace_id: string;
  name: string;
  kind: AgentClientKind;
  first_seen_at: Date;
  last_seen_at: Date | null;
}

export interface AgentTokenRow {
  id: string;
  workspace_id: string;
  agent_client_id: string;
  token_hash: string;
  token_prefix: string;
  scopes: string[];
  granted_by: string;
  expires_at: Date;
  last_used_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
}

export type OAuthFlow = "auth_code" | "device_code";
export type OAuthRequestStatus = "pending" | "authorized" | "denied" | "expired" | "consumed";

export interface AgentOAuthRequestRow {
  id: string;
  flow: OAuthFlow;
  status: OAuthRequestStatus;
  client_name: string;
  client_kind: string;
  requested_scopes: string[];
  workspace_id: string | null;
  code_challenge: string | null;
  code_challenge_method: string | null;
  redirect_uri: string | null;
  state: string | null;
  device_code: string | null;
  user_code: string | null;
  auth_code: string | null;
  authorized_by: string | null;
  agent_client_id: string | null;
  issued_token_id: string | null;
  created_at: Date;
  expires_at: Date;
}

// Agent Gateway (PRD v2.0, R2) -----------------------------------------------

export type ApprovalAction = "publish" | "rollback";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";

export interface ApprovalRow {
  id: string;
  workspace_id: string;
  site_id: string;
  action: ApprovalAction;
  deployment_id: string | null;
  target_version: number | null;
  ttl_override: string | null;
  requested_by: string;
  agent_client_id: string | null;
  message: string | null;
  status: ApprovalStatus;
  resulting_version: number | null;
  expires_at: Date;
  decided_by: string | null;
  decided_at: Date | null;
  decision_note: string | null;
  created_at: Date;
}

export interface GuestSiteRow {
  trial_id: string;
  guest_token_hash: string;
  site_id: string;
  ip_hash: string | null;
  expires_at: Date;
  claimed_by: string | null;
  claimed_at: Date | null;
  created_at: Date;
}

// Agent Gateway (PRD v2.0, R3) ------------------------------------------------

export type DomainStatus = "pending" | "verified" | "failed";
export type CertStatus = "none" | "issuing" | "active" | "renewing" | "failed";

export interface DnsRecord {
  type: "CNAME" | "TXT" | "ALIAS/ANAME";
  name: string;
  value: string;
  note?: string;
}

export interface SiteDomainRow {
  id: string;
  site_id: string;
  hostname: string;
  verification_token: string;
  dns_records: DnsRecord[];
  status: DomainStatus;
  cert_status: CertStatus;
  verified_at: Date | null;
  is_primary: boolean;
  created_by: string;
  created_at: Date;
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

-- Agent Gateway (PRD v2.0 R0): deployment/version model ---------------------
-- \`versions\` is 1:1 backfilled from \`site_versions\` (kept, untouched — see
-- lib/backfillDeployments.ts). content_digest stays NULL until CD-04 computes
-- it; NULL is a permanently valid state for legacy prefix-addressed versions.
CREATE TABLE IF NOT EXISTS versions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id        UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  number         INTEGER NOT NULL,
  storage_key    TEXT NOT NULL,
  content_digest TEXT,
  source         TEXT NOT NULL DEFAULT 'upload'
                   CHECK (source IN ('upload','agent','github','template','rollback')),
  summary        TEXT,
  author_email   TEXT NOT NULL,
  actor_type     TEXT NOT NULL DEFAULT 'human' CHECK (actor_type IN ('human','agent')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (site_id, number)
);
CREATE INDEX IF NOT EXISTS versions_site_idx ON versions (site_id, number DESC);

-- Referenced by deployments.agent_client_id below, so it must exist first.
CREATE TABLE IF NOT EXISTS agent_clients (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  kind           TEXT NOT NULL DEFAULT 'other'
                   CHECK (kind IN ('claude-code','codex','cursor','other')),
  first_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS agent_clients_workspace_idx ON agent_clients (workspace_id);

-- New addressable unit the deployment state machine (lib/deployments.ts)
-- owns. Never drives serving in R0/R1 — sites.s3_prefix/current_version stays
-- the source of truth for /s/[slug] until a later release flips a flag.
CREATE TABLE IF NOT EXISTS deployments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id               UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  version_id            UUID NOT NULL REFERENCES versions(id),
  changeset_id          UUID, -- unused until a later release; soft reference, no FK yet
  target                TEXT NOT NULL CHECK (target IN ('preview','production')),
  status                TEXT NOT NULL DEFAULT 'queued'
                          CHECK (status IN ('queued','building','ready','published','failed','canceled')),
  url                   TEXT,
  access_mode           TEXT NOT NULL DEFAULT 'inherit'
                          CHECK (access_mode IN ('password','organization','hybrid','inherit')),
  access_password_hash  TEXT,
  created_by            TEXT NOT NULL,
  actor_type            TEXT NOT NULL DEFAULT 'human' CHECK (actor_type IN ('human','agent')),
  agent_client_id       UUID REFERENCES agent_clients(id),
  build_started_at      TIMESTAMPTZ,
  build_finished_at     TIMESTAMPTZ,
  error                 JSONB,
  published_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS deployments_site_idx ON deployments (site_id, created_at DESC);
CREATE INDEX IF NOT EXISTS deployments_status_idx ON deployments (status) WHERE status IN ('queued','building');

ALTER TABLE sites ADD COLUMN IF NOT EXISTS production_deployment_id UUID REFERENCES deployments(id);

-- Agent Gateway (R1): OAuth tokens, PKCE/device-code state -------------------
-- Supersedes api_tokens for agent use only; api_tokens itself is untouched
-- and stays session-managed/full-account (a separate release retires it).
CREATE TABLE IF NOT EXISTS agent_tokens (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_client_id  UUID NOT NULL REFERENCES agent_clients(id) ON DELETE CASCADE,
  token_hash       TEXT NOT NULL UNIQUE,
  token_prefix     TEXT NOT NULL,
  scopes           TEXT[] NOT NULL DEFAULT '{}',
  granted_by       TEXT NOT NULL, -- session email of the human who approved consent
  expires_at       TIMESTAMPTZ NOT NULL, -- 90-day max enforced at mint time
  last_used_at     TIMESTAMPTZ,
  revoked_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_tokens_workspace_idx ON agent_tokens (workspace_id) WHERE revoked_at IS NULL;

-- OAuth 2.1 auth-code+PKCE and device-code state, one table for both flows
-- (a \`flow\` discriminator) so one cleanup-cron sweep handles both. Needs a
-- real status enum — pending_uploads' NULL-until-done shape only models two
-- states, not enough here.
CREATE TABLE IF NOT EXISTS agent_oauth_requests (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow                   TEXT NOT NULL CHECK (flow IN ('auth_code','device_code')),
  status                 TEXT NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending','authorized','denied','expired','consumed')),
  client_name            TEXT NOT NULL,
  client_kind            TEXT NOT NULL DEFAULT 'other',
  requested_scopes       TEXT[] NOT NULL,
  workspace_id           UUID REFERENCES workspaces(id),
  code_challenge         TEXT,
  code_challenge_method  TEXT DEFAULT 'S256',
  redirect_uri           TEXT, -- auth_code flow: loopback URI to redirect back to with ?code=
  state                  TEXT, -- auth_code flow: opaque CSRF token echoed back to the client
  device_code            TEXT UNIQUE,
  user_code              TEXT UNIQUE,
  auth_code              TEXT UNIQUE,
  authorized_by          TEXT,
  agent_client_id        UUID REFERENCES agent_clients(id),
  issued_token_id        UUID REFERENCES agent_tokens(id),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at             TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS agent_oauth_requests_device_idx ON agent_oauth_requests (device_code) WHERE device_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS agent_oauth_requests_sweep_idx ON agent_oauth_requests (expires_at) WHERE status = 'pending';

-- Idempotency + rate limiting (CD-12), Postgres-backed per the no-Redis /
-- zero-cloud-dependency portability constraint (docker compose up must work).
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key              TEXT PRIMARY KEY,
  token_id         UUID NOT NULL,
  request_hash     TEXT NOT NULL,
  response_status  INTEGER NOT NULL,
  response_body    JSONB NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idempotency_keys_sweep_idx ON idempotency_keys (created_at);

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  bucket_key    TEXT NOT NULL,
  window_start  TIMESTAMPTZ NOT NULL,
  count         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket_key, window_start)
);

-- Feature flags (CD-05): env override always wins; this table is the
-- per-workspace / global fallback. See lib/flags.ts.
CREATE TABLE IF NOT EXISTS feature_flags (
  name                TEXT PRIMARY KEY,
  enabled_globally    BOOLEAN NOT NULL DEFAULT false,
  enabled_workspaces  UUID[] NOT NULL DEFAULT '{}',
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Content-addressed storage (CD-04): refcounts for shared cas/<digest>
-- objects. A digest is safe to delete once no version references it.
CREATE TABLE IF NOT EXISTS cas_refs (
  digest      TEXT NOT NULL,
  version_id  UUID NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
  PRIMARY KEY (digest, version_id)
);
CREATE INDEX IF NOT EXISTS cas_refs_digest_idx ON cas_refs (digest);

-- Actor-type on events (agent vs human). No CHECK constraint — matches the
-- existing soft-typed \`type\` column (enforced in TS via a union, not SQL) —
-- so this ALTER stays safely re-runnable if the union ever grows.
ALTER TABLE events ADD COLUMN IF NOT EXISTS actor_type TEXT NOT NULL DEFAULT 'human';

-- Agent Gateway (PRD v2.0 R2): publish gate + approvals ---------------------
-- Workspace-level policy for agent-driven publishes/rollbacks. 'direct' = no
-- gate; 'confirm' = the existing two-step HMAC-token flow (lib/agentConfirm.ts);
-- 'approval' = a human must decide (agents cannot self-approve regardless of
-- scope). Default 'confirm' per the PRD.
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS publish_mode TEXT NOT NULL DEFAULT 'confirm';

-- One row per pending/decided publish or rollback awaiting a human decision.
-- 'publish' actions reference a ready preview deployment being promoted;
-- 'rollback' actions reference a target_version instead. Requiring a
-- concrete deployment/version (never "republish nothing changed") keeps the
-- reviewer's summary meaningful and doubles as a hard version of the R1
-- Skill's soft "preview before publish" guidance for approval-gated
-- workspaces. resulting_version is set only on approve, so
-- get_approval_status/audit can show "what actually went live" without
-- re-deriving it.
CREATE TABLE IF NOT EXISTS approvals (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  site_id            UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  action             TEXT NOT NULL DEFAULT 'publish' CHECK (action IN ('publish','rollback')),
  deployment_id      UUID REFERENCES deployments(id), -- 'publish': the preview being promoted
  target_version     INTEGER,                          -- 'rollback': the version to revert to
  ttl_override       TEXT,
  requested_by       TEXT NOT NULL,
  agent_client_id    UUID REFERENCES agent_clients(id),
  message            TEXT,
  status             TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','approved','rejected','expired')),
  resulting_version  INTEGER,
  expires_at         TIMESTAMPTZ NOT NULL,
  decided_by         TEXT,
  decided_at         TIMESTAMPTZ,
  decision_note      TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT approvals_action_target_chk CHECK (
    (action = 'publish'  AND target_version IS NULL) OR
    (action = 'rollback' AND deployment_id IS NULL AND target_version IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS approvals_workspace_idx ON approvals (workspace_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS approvals_sweep_idx ON approvals (expires_at) WHERE status = 'pending';

-- Agent Gateway (PRD v2.0 R2): guest (no-signup) publish ---------------------
-- One row per anonymous trial site. guest_token_hash is a sha256 of the
-- opaque token held in the visitor's mb_guest_token cookie (same
-- hash-and-lookup pattern as every other credential in this codebase — no
-- stored secret to leak). Claiming does not delete this row; it's the
-- permanent record of "this site started as a guest trial." UNIQUE(site_id)
-- because a site has at most one guest-trial origin.
CREATE TABLE IF NOT EXISTS guest_sites (
  trial_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_token_hash  TEXT NOT NULL,
  site_id           UUID NOT NULL UNIQUE REFERENCES sites(id) ON DELETE CASCADE,
  ip_hash           TEXT,
  expires_at        TIMESTAMPTZ NOT NULL,
  claimed_by        TEXT,
  claimed_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS guest_sites_token_idx ON guest_sites (guest_token_hash);
CREATE INDEX IF NOT EXISTS guest_sites_unclaimed_idx ON guest_sites (expires_at) WHERE claimed_by IS NULL;

-- Agent Gateway (PRD v2.0 R3): custom domains + host-based routing ----------
-- primary_host is informational (which host is "the" address to show for
-- this site — a verified custom domain once one exists) — it is never
-- read for authorization or resolution; middleware.ts resolves purely from
-- the incoming Host header against site_domains / the slug pattern, so a
-- stale primary_host can never misroute or leak access.
ALTER TABLE sites ADD COLUMN IF NOT EXISTS primary_host TEXT;

-- One row per custom hostname a site owner has pointed at their site.
-- dns_records is a snapshot of the records add_custom_domain told the
-- caller to create (CNAME for a subdomain, ALIAS/ANAME guidance for an
-- apex, TXT for the ownership challenge) — kept so verify_custom_domain and
-- the UI can show the exact same values without recomputing them
-- (verification_token is random per domain, so recomputing could hand back
-- different values than what the operator was actually told to create).
-- cert_status is bookkeeping for CD-22 (certificate issuance) — this
-- release only ever writes 'none'/'issuing'/'failed' via a stub; the real
-- ACME flow lands in a later release and is explicitly not implemented yet.
CREATE TABLE IF NOT EXISTS site_domains (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id              UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  hostname             TEXT NOT NULL UNIQUE,
  verification_token   TEXT NOT NULL,
  dns_records          JSONB NOT NULL DEFAULT '[]',
  status               TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','failed')),
  cert_status          TEXT NOT NULL DEFAULT 'none'
                         CHECK (cert_status IN ('none','issuing','active','renewing','failed')),
  verified_at          TIMESTAMPTZ,
  is_primary           BOOLEAN NOT NULL DEFAULT false,
  created_by           TEXT NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS site_domains_site_idx ON site_domains (site_id);
CREATE UNIQUE INDEX IF NOT EXISTS site_domains_primary_idx ON site_domains (site_id) WHERE is_primary;
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
