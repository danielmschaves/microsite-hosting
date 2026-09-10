# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Status

Built and deployed: the MVP (PRD §8) plus the v1.0 feature set (teams/workspaces, billing, multi-page sites, presigned uploads, trash, versioning, token API, public links, expiry notifications). The full specification is in `PRD.md`; the sections below describe what exists in the codebase.

**In progress, behind flags (PRD v2.0 — R0 Foundation + R1 Agent Gateway + R2 in progress):** an MCP server, OAuth 2.1 for agents, and a scoped agent-token model sit alongside the v1.0 product with **zero user-visible change** while the corresponding `MICROBUILD_FLAG_*` env vars are unset. R2's first piece (CD-14) has landed: every publish path (not just the agent one) now maintains `versions`/`deployments` bookkeeping, and `/s/[slug]` serving can read from it behind the `deployment_serving` flag, self-healing to the legacy `sites.s3_prefix` columns on any inconsistency. See "Agent Gateway (PRD v2.0)" below. `PRD-v2.md` (if present) has the full seven-release plan.

## Build Goal (PRD §8.5)

> Build a Next.js app ("Shipsite MVP") that lets an authenticated user upload a single HTML file, stores it in S3-compatible storage, serves it at `/s/{slug}` only to logged-in allowed users, and deletes it after its TTL. Include docker-compose (app + Postgres + MinIO), Auth.js with Google/GitHub, a cron-callable cleanup endpoint, and a minimal dashboard. All external services configurable via env vars.

## MVP Stack

| Concern | Choice |
|---|---|
| App | Next.js (App Router) |
| Auth | Auth.js (NextAuth v5) — Google + GitHub OAuth |
| Storage | S3-compatible (AWS S3 in prod; MinIO locally) |
| Database | Postgres (Neon in prod; local Postgres in Docker) |
| TTL sweep | Cron-triggered internal route (`/api/cleanup`) |
| Content serving | Authenticated Next.js route handler at `/s/[slug]/[...path]` streaming from S3 |
| Local dev | `docker compose up` — app + Postgres + MinIO |

## Commands

```bash
docker compose up          # Full local stack: app + Postgres + MinIO
npm run dev                # Next.js dev server (needs env vars set)
npm run build               # Production build
npm run lint                # ESLint
npm test                    # Vitest — currently covers lib/deploymentStateMachine.ts's transition table
npm run build --workspace packages/mcp-server   # Build the @microbuild/mcp package
```

## Critical Architectural Constraints

**Docker-first portability:** The entire app must run via `docker compose up` with zero cloud dependencies. MinIO substitutes S3; local Postgres substitutes Neon. Cloud services are injected only through environment variables — nothing in the codebase may hard-code Vercel-only primitives.

**Storage adapter pattern:** Abstract S3 operations behind a storage adapter so the backing store (Vercel Blob / AWS S3 / MinIO) is swappable via env var. This is the migration path to v1.0.

**Auth-gated content serving:** All sites are private by default. The route handler at `/s/[slug]/[...path]` must verify the Auth.js session and check `canViewSite` in Postgres *before* streaming any bytes from S3 — never expose S3 URLs directly. The one exception is `visibility='public'` ("anyone with the link", owner-toggled with a warning): anonymous requests serve with `X-Robots-Tag: noindex`; everything else still hits the login wall.

**No Vercel-specific primitives in core logic:** Cron trigger, storage calls, and auth callbacks must be reachable from either a Vercel deployment or a plain Docker container. Use standard Next.js API routes, not Vercel-specific SDK features.

## Key Routes

Pages (App Router):
- `/` — landing / sign-in (redirects to `/dashboard` when authed)
- `/login` — branded login wall; wired as Auth.js `pages.signIn`, so gated `/s/*` viewers land here with `callbackUrl` preserved
- `/dashboard` — site list (grid/list toggle, search, live TTL countdowns, copy/extend/delete)
- `/upload` — "Publish a page": dropzone + config (slug, TTL, viewer allowlist chips) + summary panel
- `/settings` — profile + configured sign-in providers + sign out

- `/sites/[id]` — owner-only manage panel (two-column, per the design's Site Detail screen): stats, pages list + set-as-index, versions + rollback, who-can-view (only_me/allowlist/team radios + public toggle), lifecycle/TTL, slug rename, danger zone (force-expire, trash/restore/purge)
- `/teams`, `/teams/[id]` — workspaces (Team Admin screen): stat tiles, all-team-sites table (admin force-expire/trash), members ∥ audit log (CSV export, team plan), invites, billing card, max-TTL policy
- `/trash` — personal trash + admin view of workspace trash; restore (owner) / purge, "purges in Nd" countdowns
- `/plans` — Free/Team/Business pricing cards driven by `lib/plan.ts` constants; renders for anonymous and signed-in users
- `/api-cli` — API & CLI page: curl example, access-token manager (secret shown once), REST endpoint reference
- `/invite/[token]` — invite acceptance (email-bound, 14d expiry)

API / handlers:
- `/s/[slug]/[[...path]]` — content serving: site lookup first, then session gate (skipped only for `public`), then `canViewSite`, then stream from S3; records a `site_view` event (actor NULL for anonymous)
- `/api/upload` — POST: accepts 1–20 `.html` files (multi-page; `index` field or auto-detected `index.html`), stores under a slug-decoupled S3 prefix (`sites/{slug}-{ts}/`); re-uploading your own live slug publishes a **new version** at the same URL (anyone else's slug is still 409). Thin wrapper over `lib/uploadService.ts` `performServerUpload`
- `/api/sites/[id]` — DELETE (move to trash; `?permanent=true` purges storage incl. all version prefixes) · PATCH (`{ttl}` extend, `{slug}` rename — metadata-only, prefix never moves, `{visibility}`, `{index}` set-as-index, `{action:"restore"|"force_expire"}`); ttl/slug/visibility live in `lib/siteMutations.ts`, shared with the v1 API
- `/api/sites/[id]/versions/rollback` — POST `{version}`: instant metadata pointer flip to a retained version
- `/api/sites/[id]/viewers` — GET/POST/DELETE: allowlist CRUD, effective immediately
- `/api/cleanup` — GET/POST, `Authorization: Bearer $CRON_SECRET`: phase 0 sends T-48h/T-2h expiry emails (marker columns keep any cadence idempotent); phase 1 trashes expired sites (storage kept); phase 2 purges storage for sites trashed > 7 days via `purgeSiteStorage`; phase 3 purges incomplete presigned uploads > 24h
- `/api/notifications` — GET: caller's live sites expiring <48h (feeds the AppBar bell; no read-state)
- `/api/tokens` (+`/[id]`) — session-only API-token CRUD (`lib/apiTokens.ts`; sha256 hash stored, secret returned exactly once)
- `/api/v1/sites[...]` — Bearer-token REST API (owner-scoped): GET list, POST create/republish (multipart ≤4MB), PUT `{slug}/content` new version, PATCH ttl/visibility/slug, DELETE trash/`?permanent=true`
- `/api/upload/presign` + `/api/upload/complete` — presigned browser→S3 path (no server body cap); `/api/upload` is the ≤4MB multipart fallback; both share `lib/createSite.ts` and support re-publish (update mode)
- `/api/workspaces[...]` — workspace CRUD, members (owner immovable), invites (admin+), audit (admin+, team plan), billing checkout/portal (owner)
- `/api/invites/[token]` — POST accept (session email must equal invited email)
- `/api/stripe/webhook` — signature-verified; `lib/billing.ts` `syncSubscriptionToWorkspace` is the SOLE writer of plan/seats/status

Agent Gateway (PRD v2.0 R0/R1 — all behind flags, see below):
- `/oauth/consent`, `/oauth/device` — human-facing OAuth consent + device-code verification pages
- `/teams/[id]/agents` — Agent Console (admin-only): connected clients, tokens + scope chips, revoke, 24h activity feed
- `/s/[slug]/preview/[deploymentId]/[[...path]]` — preview-deployment serving; gated on the *site's* `canViewSite` plus `deployments.status='ready' AND target='preview'`; never touches the live `sites` pointer
- `/api/oauth/authorize`, `/api/oauth/consent`, `/api/oauth/token`, `/api/oauth/device` — OAuth 2.1 auth-code+PKCE and device-code flows; state in `agent_oauth_requests`
- `/api/agent/projects`, `/api/agent/sites[...]`, `/api/agent/previews/[id]` — the 14 R1 MCP tools' REST surface, Bearer `agent_tokens` auth via `lib/agentAuthz.ts` `requireAgentScope`, workspace-scoped (never owner-email scoped like `/api/v1`)
- `/api/agent-tokens/[id]`, `/api/agent-activity` — session-authenticated Agent Console CRUD/feed
- `/api/admin/backfill-deployments` — `CRON_SECRET`-authed, one-time-but-idempotent backfill of `versions`/`deployments` from `site_versions`/`sites` + a read-only addressing-parity verifier (`lib/backfillDeployments.ts`)

## Authorization & plans

- All site access decisions live in `lib/authz.ts` (`canViewSite`, `authorizeSiteManage`); workspace role guards in `lib/teams.ts` (`requireWorkspaceRole`). Never inline auth checks in routes.
- Plans in `lib/plan.ts`: free (5 sites / 25MB / 7d TTL) vs team (100 / 250MB / 90d / 30d audit). **Team visibility is the paywall.** Gates return 402 + `upgradeUrl` and apply to new operations only — existing sites are grandfathered. `PLAN_FAKE_TEAM=true` fakes team locally (blocked on Vercel prod).
- Optional services degrade gracefully via env detection: Resend (`lib/email.ts` — invite links always returned for copy-paste), Stripe (`billingEnabled`), presigned uploads (`S3_PUBLIC_ENDPOINT` for the docker browser-vs-container endpoint split).

## Front-end / design system

Ported from the "MicroBuild" Claude Design project. Do not hand-edit tokens ad hoc — keep them centralized:
- **Design tokens** live in `app/globals.css` as CSS custom properties. Dark is the default theme; `[data-theme="light"]` on `<html>` swaps the palette. A no-FOUC inline script in `app/layout.tsx` applies the persisted theme (`localStorage` key `mb-theme`) before paint; `components/ThemeToggle.tsx` flips it.
- **Fonts** via `next/font/google` (Hanken Grotesk UI, JetBrains Mono) exposed as `--font-ui` / `--font-mono`.
- **Icons** via `lucide-react` (not the mockup's CDN `<script>`).
- Reusable class primitives (`.btn`, `.card`, `.field`, `.seg`, `.icon-btn`) are in `globals.css`; components layer inline styles for layout on top, referencing the token vars.
- `components/AppBar.tsx` is the shared top bar (real storage meter + site count from `lib/plan.ts` limits).

## Data Model (core tables)

- `sites` — slug, owner_email, s3_prefix, index_key, size_bytes, page_count, ttl_preset, expires_at, deleted_at (= in trash), purged_at (= storage gone, unrestorable), visibility (`only_me|allowlist|team|public`), current_version, notified_48h_at/notified_2h_at (expiry-notice markers, cleared on extend/restore/republish)
- `site_versions` — per-publish history (site_id, version, s3_prefix, index_key, sizes). The `sites` row is the live pointer; each version keeps its own S3 prefix, so rollback is a pointer flip and pruning (plan `versionLimit`: free 1 / team 5) never touches the live prefix. All storage deletion goes through `purgeSiteStorage` in `lib/createSite.ts`
- `api_tokens` — owner_email, name, token_hash (sha256, unique), token_prefix, last_used_at, revoked_at
- `site_viewers` — site_id, viewer_email (the allowlist)
- `events` — first-party analytics (type, site_id, actor, meta jsonb, actor_type `human|agent`); captured server-side via `lib/events.ts` `track()`; no third-party SDK

Lifecycle: live (`deleted_at IS NULL`, unexpired) → trash (`deleted_at` set, storage kept, restorable) → purged (`purged_at` set after `TRASH_DAYS`). Serving requires live. The S3 prefix embeds a timestamp so trashed sites never collide with a new site reusing the slug.

Auth uses JWT sessions (no DB adapter), so there is no `users` table — the allowlist is matched against the session email.

**Agent Gateway tables (PRD v2.0 R0/R1, additive only — see "Agent Gateway" below):** `versions`/`deployments` (new deployment-model bookkeeping layered on top of `sites`/`site_versions`, which remain the source of truth for serving), `agent_clients`/`agent_tokens` (workspace-scoped, scoped OAuth tokens — distinct from the owner-scoped, full-account `api_tokens`), `agent_oauth_requests` (short-lived PKCE/device-code state), `idempotency_keys`/`rate_limit_buckets` (Postgres-backed, no Redis), `feature_flags`, `cas_refs` (content-addressed storage refcounts, unused until a publish path is wired to `lib/cas.ts`).

## Agent Gateway (PRD v2.0 — R0 Foundation + R1 Agent Gateway)

Lets an AI agent (Claude Code, Codex, Cursor) go from "I have an HTML file" to a private, expiring
URL via MCP tools instead of the human dashboard — with `visibility` and `ttl` as *required*
arguments on the publishing tool, MicroBuild's actual differentiator. Ships entirely behind
feature flags (`lib/flags.ts`) so v1.0 behavior is byte-for-byte unchanged while they're off.

**Feature flags** (env override always wins — `MICROBUILD_FLAG_<NAME>=true|false` — else the
`feature_flags` table's `enabled_globally`/`enabled_workspaces`; missing row = disabled):
- `agent_gateway` — master switch for every `/api/agent/**` and `/api/oauth/**` route; **404s**
  (not 403) when off, matching `requireWorkspaceRole`'s "hide existence from non-members" policy.
- `agent_oauth` — narrower switch just for the OAuth endpoints, so that plumbing can be
  smoke-tested before the MCP server/tools are wired to it.
- `agent_console_ui` — gates whether `/teams/[id]/agents` renders/404s and whether `TeamPanel.tsx`
  links to it.
- `deployment_serving` (PRD v2.0 R2, CD-14) — when on, `/s/[slug]` resolves its object-storage key
  via `sites.production_deployment_id → deployments.version_id → versions.storage_key`
  (`lib/deployments.ts` `resolveProductionServingKey`) instead of `sites.s3_prefix`/`index_key`
  directly. Self-healing: on any missing deployment/version or an addressing mismatch (the same
  invariant `verifyAddressingParity()` checks), it falls back to the legacy columns and
  `console.warn`s rather than failing the request — flipping this flag is provably a no-op in bytes
  served today, since every publish path keeps `versions.storage_key` equal to `sites.s3_prefix` by
  construction (see below).

**Data model / auth model:** `sites.production_deployment_id` points at a `deployments` row that
**every** publish path now maintains — `lib/createSite.ts`'s `publishSiteVersion` (dashboard
upload, presigned completion, v1 API) and `createSiteRecord` (every new site) both call
`lib/deployments.ts`'s `recordProductionDeployment` after their own transaction commits; agent
publishes and `rollbackToVersion` go through the same helper. This closed a real R1 gap where only
agent-initiated publishes updated the deployment model — everything else left
`production_deployment_id` `NULL` or stale. The helper is best-effort/non-blocking (never throws;
logs and returns `null` on failure) precisely because `resolveProductionServingKey`'s self-healing
read is the actual safety net, not perfect bookkeeping. `sites`/`site_versions`/`api_tokens` are
still untouched by any of this and remain fully functional on their own. Agent tokens (`mb_agent_`
prefix, `lib/agentTokens.ts`, sha256-hashed like `api_tokens`) are bound to a **workspace**, not an
owner email, and carry a scope array (`lib/agentAuthz.ts` `AgentScope`, 14 scopes mirroring
Showly's model — only 8 are enforced by any R1 tool today, see `R1_ENFORCED_SCOPES`). Every
`/api/agent/**` route checks `sites.workspace_id = agent_tokens.workspace_id` directly — it
deliberately does **not** reuse `/api/v1`'s owner-email-only `ownedSite()` helper.
`lib/deployments.ts`'s state machine (`queued→building→ready→published|failed|canceled`) is
additive bookkeeping layered on top of `publishSiteVersion`, not a replacement for it.

**Packages:** `packages/mcp-server` (`@microbuild/mcp`, npm workspace) — stdio MCP server, `npx
@microbuild/mcp install --to claude-code|codex|cursor` writes client config and runs the
device-code auth flow; `packages/skill` (`@microbuild/skill`) — `SKILL.md` workflow guidance
(always pass explicit visibility/ttl, preview before publish).

**Two-step confirmation:** `publish_site`, `rollback_to_version`, `delete_site` each return an
HMAC-signed `confirmToken` (keyed on `AUTH_SECRET`, `lib/agentConfirm.ts`, 5-minute expiry) on a
first call and require it on the second. `publish_site`/`rollback_to_version` also require an
`Idempotency-Key` header (`lib/idempotency.ts`, replay window 24h, Postgres-backed); rate limits
are enforced per-token in `requireAgentScope` (`lib/rateLimit.ts`: 120 reads/min, 20 writes/min, 5
publishes/min).

## Scope

**Shipped (MVP + v1.0):** multi-page `.html` upload (multipart + presigned), login-walled viewing (Google/GitHub), per-site allowlists, public link mode, TTL presets + notifications (T-48h/T-2h email + bell), trash/restore/purge via cron, versioning + rollback, teams/workspaces with roles/invites/audit/billing (Stripe), max-TTL policy, token REST API, dashboard/trash/plans/api-cli pages.

**Built, behind flags (PRD v2.0 R0+R1):** MCP server + 14 agent tools, OAuth 2.1 (auth-code+PKCE +
device-code) for agents, scoped `agent_tokens`, preview deployments, deployment state machine,
Agent Console UI, Postgres-backed rate limiting/idempotency, content-addressed storage primitives
(`lib/cas.ts`, not yet wired into any publish path). See "Agent Gateway" above.

**Still out (v1.1+ / PRD v2.0 R2+):** dedicated CLI package (`@microbuild/cli` — the human-facing
v1 API already exists; `@microbuild/mcp` is the agent-facing one), custom SSO (SAML/OIDC, M3),
subdomain-per-site, rate limiting on the v1 API (the *agent* API is rate-limited; v1 is not),
anonymous-view event retention sweep, publish approval workflow, custom domains, version diffs,
build pipeline, guest/no-signup publish.

## Environment Variables (core ones required; see DEPLOY.md for optional Resend/Stripe/presign vars)

```
# Auth.js
AUTH_SECRET=
AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=
AUTH_GITHUB_ID=
AUTH_GITHUB_SECRET=

# Storage (S3 / MinIO)
S3_ENDPOINT=           # blank = AWS; set to http://minio:9000 for local
S3_BUCKET=
S3_REGION=
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=

# Database
DATABASE_URL=          # postgres:// connection string

# App
NEXTAUTH_URL=          # e.g. http://localhost:3000

# Agent Gateway (PRD v2.0 R0/R1/R2) — all optional, default off/unset
CRON_SECRET=                          # also gates /api/admin/backfill-deployments
MICROBUILD_FLAG_AGENT_GATEWAY=false
MICROBUILD_FLAG_AGENT_OAUTH=false
MICROBUILD_FLAG_AGENT_CONSOLE_UI=false
MICROBUILD_FLAG_DEPLOYMENT_SERVING=false
MICROBUILD_BASE_URL=                  # packages/mcp-server: which deployment to talk to
```
