# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Status

Built and deployed: the MVP (PRD §8) plus the v1.0 feature set (teams/workspaces, billing, multi-page sites, presigned uploads, trash, versioning, token API, public links, expiry notifications). The full specification is in `PRD.md`; the sections below describe what exists in the codebase.

**In progress, behind flags (PRD v2.0 — R0 Foundation + R1 Agent Gateway + R2 Previews/gates/guest publish + R3 Real addresses and real numbers, partial):** an MCP server, OAuth 2.1 for agents, and a scoped agent-token model sit alongside the v1.0 product with **zero user-visible change to existing flows** while the corresponding `MICROBUILD_FLAG_*` env vars are unset. R2 has landed in full: CD-14 (every publish path — not just the agent one — now maintains `versions`/`deployments` bookkeeping, and `/s/[slug]` serving can read from it behind the `deployment_serving` flag, self-healing to the legacy `sites.s3_prefix` columns on any inconsistency); CD-15 (per-preview access modes — password/organization/hybrid, argon2id); CD-16 (a workspace `publish_mode` gate — direct/confirm/approval — in front of agent publish/rollback); CD-17 (human approvals for gated publishes/rollbacks, `/teams/[id]/approvals`); CD-18 (anonymous no-signup trial publish at `/try` + claim at `/claim` — the one R2 piece that is deliberately new, live, user-facing surface, not hidden behind a flag, since guest publish has no existing behavior to stay invisible to); CD-19 (cleanup phase 5: approvals sweep, immediate purge for unclaimed guest trials, orphaned preview cleanup). R3 has landed CD-20 (host-based routing via `middleware.ts`, config-gated and a no-op when unconfigured) and CD-21 (real custom domains — CNAME/TXT verification, `/sites/[id]/domains`); CD-22 (certificate issuance), CD-23 (insights pipeline) and CD-24 (the remaining R3 tool) are not yet built. See "Agent Gateway (PRD v2.0)" and "Host-based routing & custom domains (PRD v2.0 R3)" below. `PRD-v2.md` (if present) has the full seven-release plan.

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

- `/sites/[id]` — owner-only manage panel (two-column, per the design's Site Detail screen): stats, pages list + set-as-index, versions + rollback, who-can-view (only_me/allowlist/team radios + public toggle), lifecycle/TTL, slug rename, danger zone (force-expire, trash/restore/purge), links to `/sites/[id]/domains`
- `/sites/[id]/domains` — owner or workspace admin (PRD v2.0 CD-21): add/verify/remove custom domains, DNS records shown as copyable rows, set-primary
- `/teams`, `/teams/[id]` — workspaces (Team Admin screen): stat tiles, all-team-sites table (admin force-expire/trash), members ∥ audit log (CSV export, team plan), invites, billing card, max-TTL policy
- `/trash` — personal trash + admin view of workspace trash; restore (owner) / purge, "purges in Nd" countdowns
- `/plans` — Free/Team/Business pricing cards driven by `lib/plan.ts` constants; renders for anonymous and signed-in users
- `/api-cli` — API & CLI page: curl example, access-token manager (secret shown once), REST endpoint reference
- `/invite/[token]` — invite acceptance (email-bound, 14d expiry)
- `/try` — anonymous no-signup trial publish (PRD v2.0 CD-18): one `.html` file ≤5MB, fixed 24h TTL + public visibility, 3 publishes/hour/IP; result card links to `/claim`
- `/claim` — session-gated: claims every unclaimed trial site the caller's `mb_guest_token` cookie matches, extends TTL to 7d, transfers ownership

API / handlers:
- `middleware.ts` + `/mbhost/[[...path]]` — host-based routing (PRD v2.0 CD-20). Every request to this app's own canonical host (`NEXT_PUBLIC_BASE_URL`/`NEXTAUTH_URL`'s hostname, plus `localhost`) passes through middleware unmodified; any other Host header is rewritten to `/mbhost/*`, a plain `nodejs`-runtime route that resolves it (synthetic `{slug}.<apex>` / `{deploymentId}.<previewApex>` subdomains when `MICROBUILD_APEX_DOMAIN`/`_PREVIEW_APEX_DOMAIN` are set, else a verified `site_domains` lookup) and delegates to the exact same serving logic as the path-based routes below (`lib/siteServing.ts`/`lib/previewServing.ts` — shared, not duplicated). `/s/{slug}` and `/s/{slug}/preview/{id}` keep working unconditionally regardless of host-based routing. **Pitfall already hit once:** `app/_host/...` (leading underscore) is a Next.js *private folder* and is silently unroutable — this is `app/mbhost/...` for exactly that reason. **Pitfall #2:** the mere presence of `middleware.ts` makes Next also edge-compile `instrumentation.ts`, which pulls in `pg` (Node-only) — `instrumentation.ts`'s dynamic imports of `lib/db`/`lib/storage` are built from a variable, not a string literal, specifically so webpack can't statically bundle them for that edge pass; don't "clean up" that indirection back to a literal import.
- `/s/[slug]/[[...path]]` — content serving: site lookup first, then session gate (skipped only for `public`), then `canViewSite`, then stream from S3; records a `site_view` event (actor NULL for anonymous)
- `/api/upload` — POST: accepts 1–20 `.html` files (multi-page; `index` field or auto-detected `index.html`), stores under a slug-decoupled S3 prefix (`sites/{slug}-{ts}/`); re-uploading your own live slug publishes a **new version** at the same URL (anyone else's slug is still 409). Thin wrapper over `lib/uploadService.ts` `performServerUpload`
- `/api/sites/[id]` — DELETE (move to trash; `?permanent=true` purges storage incl. all version prefixes) · PATCH (`{ttl}` extend, `{slug}` rename — metadata-only, prefix never moves, `{visibility}`, `{index}` set-as-index, `{action:"restore"|"force_expire"}`); ttl/slug/visibility live in `lib/siteMutations.ts`, shared with the v1 API
- `/api/sites/[id]/versions/rollback` — POST `{version}`: instant metadata pointer flip to a retained version
- `/api/sites/[id]/viewers` — GET/POST/DELETE: allowlist CRUD, effective immediately
- `/api/sites/[id]/domains` (+`/[domainId]`) — session-only custom-domain CRUD (PRD v2.0 CD-21, owner or workspace admin): GET/POST list/add, PATCH `{action:"verify"|"set_primary"}`, DELETE; `lib/domains.ts` generates the DNS records and does the real `dns.resolveTxt` verification, shared with the agent routes below
- `/api/cleanup` — GET/POST, `Authorization: Bearer $CRON_SECRET`: phase 0 sends T-48h/T-2h expiry emails (marker columns keep any cadence idempotent); phase 1 trashes expired sites (storage kept); phase 2 purges storage for sites trashed > 7 days via `purgeSiteStorage` (unclaimed guest-trial sites skip the grace period — purged as soon as trashed); phase 3 purges incomplete presigned uploads > 24h; phase 4 sweeps stale OAuth requests/rate-limit/idempotency state; phase 5 (PRD v2.0 CD-19) expires+prunes `approvals` and cancels+purges orphaned preview `deployments` stuck in `queued`/`building`/`ready`
- `/api/notifications` — GET: caller's live sites expiring <48h, plus (CD-17) pending agent approval requests in workspaces the caller admins (feeds the AppBar bell; no read-state)
- `/api/guest/publish` — POST, anonymous, multipart single `.html` file: backs `/try`; `lib/guestPublish.ts`
- `/api/guest/claim` — POST, session-required: backs `/claim`; reads the `mb_guest_token` cookie server-side
- `/api/tokens` (+`/[id]`) — session-only API-token CRUD (`lib/apiTokens.ts`; sha256 hash stored, secret returned exactly once)
- `/api/v1/sites[...]` — Bearer-token REST API (owner-scoped): GET list, POST create/republish (multipart ≤4MB), PUT `{slug}/content` new version, PATCH ttl/visibility/slug, DELETE trash/`?permanent=true`
- `/api/upload/presign` + `/api/upload/complete` — presigned browser→S3 path (no server body cap); `/api/upload` is the ≤4MB multipart fallback; both share `lib/createSite.ts` and support re-publish (update mode)
- `/api/workspaces[...]` — workspace CRUD, members (owner immovable), invites (admin+), audit (admin+, team plan), billing checkout/portal (owner)
- `/api/invites/[token]` — POST accept (session email must equal invited email)
- `/api/stripe/webhook` — signature-verified; `lib/billing.ts` `syncSubscriptionToWorkspace` is the SOLE writer of plan/seats/status

Agent Gateway (PRD v2.0 R0/R1/R2 — all behind flags, see below):
- `/oauth/consent`, `/oauth/device` — human-facing OAuth consent + device-code verification pages
- `/teams/[id]/agents` — Agent Console (admin-only): connected clients, tokens + scope chips, revoke, 24h activity feed
- `/teams/[id]/approvals` — Approvals inbox (admin-only, CD-17): pending agent publish/rollback requests, approve/reject with an optional note, keyboard-only (plain `<button>`/`<input>`, no click-handler `<div>`s)
- `/s/[slug]/preview/[deploymentId]/[[...path]]` — preview-deployment serving; gated on `deployments.status='ready' AND target='preview'` PLUS the deployment's own `access_mode` (CD-15): `inherit` (default) keeps the exact pre-CD-15 behavior (the site's own `canViewSite`); `organization` requires workspace membership; `password`/`hybrid` require a signed `mb_preview_pw_<deploymentId>` cookie proving a prior argon2id password check (`POST` on the same route renders/handles the password form) — never touches the live `sites` pointer
- `/api/oauth/authorize`, `/api/oauth/consent`, `/api/oauth/token`, `/api/oauth/device` — OAuth 2.1 auth-code+PKCE and device-code flows; state in `agent_oauth_requests`
- `/api/agent/projects`, `/api/agent/sites[...]`, `/api/agent/previews/[id]` — the 14 R1 MCP tools' REST surface, Bearer `agent_tokens` auth via `lib/agentAuthz.ts` `requireAgentScope`, workspace-scoped (never owner-email scoped like `/api/v1`); `/api/agent/previews/[id]` also takes `PATCH` (`set_preview_access`, CD-15)
- `/api/agent/sites/[id]/publish/request` — POST, `publish:request`: `request_publish` — creates a pending `approvals` row (CD-17); the only route that ever inserts into `approvals`, so "agents cannot self-approve" has one structural home
- `/api/agent/approvals/[id]` — GET, `publish:request` (cheap read bucket): `get_approval_status`
- `/api/agent/guest/claim` — POST, `site:write`: `claim_trial_site` (CD-18) — claims trial site(s) to the agent token's `granted_by` email
- `/api/agent/sites/[id]/domains` — GET (`site:read`) `list_site_domains` / POST (`site:write`) `add_custom_domain` (CD-21); `/api/agent/sites/[id]/domains/[domainId]/verify` — POST (`site:write`) `verify_custom_domain`, idempotent
- `/api/agent-tokens/[id]`, `/api/agent-activity` — session-authenticated Agent Console CRUD/feed
- `/api/approvals/[id]` — POST, **session-authenticated only, never Bearer** (CD-17): `{decision: "approve"|"reject", note?}`, admin+ only — this omission of `requireAgentScope` IS the "agents cannot self-approve" enforcement mechanism, not a policy check layered on top
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

**Agent Gateway tables (PRD v2.0 R0/R1/R2/R3, additive only — see "Agent Gateway" below):** `versions`/`deployments` (new deployment-model bookkeeping layered on top of `sites`/`site_versions`, which remain the source of truth for serving), `agent_clients`/`agent_tokens` (workspace-scoped, scoped OAuth tokens — distinct from the owner-scoped, full-account `api_tokens`), `agent_oauth_requests` (short-lived PKCE/device-code state), `idempotency_keys`/`rate_limit_buckets` (Postgres-backed, no Redis), `feature_flags`, `cas_refs` (content-addressed storage refcounts, unused until a publish path is wired to `lib/cas.ts`), `workspaces.publish_mode` (CD-16: `direct|confirm|approval`, default `confirm`), `approvals` (CD-17: pending/decided publish-or-rollback requests, `resulting_version` set only on approve), `guest_sites` (CD-18: `guest_token_hash` — sha256 of the `mb_guest_token` cookie — mapped to a plain `sites` row, `UNIQUE(site_id)`, `claimed_by`/`claimed_at` set on claim), `sites.primary_host` (CD-21, informational only — never read for authorization/resolution, so a stale value can never misroute), `site_domains` (CD-21: hostname, `verification_token`, `dns_records` jsonb snapshot, `status` pending/verified/failed, `cert_status` none/issuing/active/renewing/failed — this release only ever writes `'none'`, real issuance is CD-22, not yet built; `is_primary` unique-per-site).

## Agent Gateway (PRD v2.0 — R0 Foundation + R1 Agent Gateway + R2 Previews/gates/guest publish)

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

CD-15 through CD-19 introduce **no new flags** — CD-15/16/17 reuse `agent_gateway` (their routes
all live under `/api/agent/**`) and `agent_console_ui` (the Approvals inbox reuses the same
admin-surface gate as the Agent Console), and CD-18's guest publish (`/try`, `/claim`) is
deliberately unflagged: it is new, additive, user-facing surface with no existing v1.0 behavior to
stay invisible to, unlike the Agent Gateway proper.

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

**Preview access modes (CD-15):** each `deployments` row carries its own `access_mode`
(`password|organization|hybrid|inherit`, default `inherit`) and `access_password_hash`
(argon2id — the real `argon2` npm package, the first compiled/native dependency in this repo;
`Dockerfile`'s `deps` stage installs `python3 make g++` so its build succeeds on Alpine even without
a matching prebuilt binary, and CI runs an actual `docker build` to catch a musl-specific failure
the glibc `ubuntu-latest` runner can't). `inherit` is byte-for-byte the pre-CD-15 behavior (the
site's own `canViewSite`); `organization` requires workspace membership regardless of the site's own
visibility; `password`/`hybrid` gate on a signed `mb_preview_pw_<deploymentId>` cookie
(`lib/previewAccess.ts`, same HMAC construction as `lib/agentConfirm.ts`) proving a prior password
check — the plaintext password is never stored, only its argon2id hash.

**Publish gate (CD-16):** `workspaces.publish_mode` (`direct|confirm|approval`, default `confirm`)
governs `publish_site`/`rollback_to_version`. `direct` skips confirmation and executes on the first
call; `confirm` is the pre-R2 two-step HMAC flow, now with a 10-minute TTL (`lib/agentConfirm.ts`'s
`createConfirmToken`/`verifyConfirmToken` took an optional `ttlMs`, default unchanged at 5 minutes
for `delete_site`); `approval` always rejects with `{error:"approval_required"}` — neither
`/api/agent/sites/[id]/publish` nor `.../rollback` ever creates an `approvals` row itself, so a
`publish:confirm`-scoped token has no path around a human decision even if it tries.

**Approvals (CD-17):** `request_publish` creates a pending `approvals` row (72h expiry, deduped
against an existing pending request for the same `(site_id, action)`) and emails every admin+
workspace member (`lib/email.ts`'s `approvalRequestedEmail`, degrading like every other email here).
A human decides on `POST /api/approvals/{id}` — **session-authenticated only**, no `requireAgentScope`
import anywhere in that file; that absence is the entire "agents cannot self-approve" enforcement,
not a check layered on top of a shared auth path. Approving executes the underlying
`publishSiteVersion`/`rollbackToVersion` attributed to the original requester
(`approvals.requested_by`), not the approver, and records `resulting_version`.

**Guest publish + claim (CD-18):** `lib/guestPublish.ts` — deliberately not built on
`lib/uploadService.ts`'s `performServerUpload`, which assumes an authenticated email and
workspace/plan context a `/try` visitor doesn't have. One file, 5MB cap (stricter than any
authenticated tier), fixed `24h`/`public`, `owner_email` synthesized as
`guest+<hex>@guest.microbuild.invalid` (RFC 2606 `.invalid`, never deliverable, never collides).
3 publishes/hour/IP (`lib/requestIp.ts` — first `X-Forwarded-For` hop, `"unknown"` with no reverse
proxy in front, an explicit dev-only limitation). The `mb_guest_token` cookie is intentionally
non-unique per site, so one browser can accumulate multiple trial sites before claiming them all at
`/claim`; claiming extends the TTL to 7d and clears notification markers so a freshly-claimed site
doesn't expire minutes later.

**Packages:** `packages/mcp-server` (`@microbuild/mcp`, npm workspace) — stdio MCP server, `npx
@microbuild/mcp install --to claude-code|codex|cursor` writes client config and runs the
device-code auth flow; `packages/skill` (`@microbuild/skill`) — `SKILL.md` workflow guidance
(always pass explicit visibility/ttl, preview before publish).

**Two-step confirmation:** `publish_site`, `rollback_to_version`, `delete_site` each return an
HMAC-signed `confirmToken` (keyed on `AUTH_SECRET`, `lib/agentConfirm.ts`) on a first call and
require it on the second — `delete_site` at the original 5-minute TTL, `publish_site`/
`rollback_to_version` at 10 minutes per CD-16's NFR (only when the workspace's `publish_mode` is
`confirm`; see "Publish gate" above for `direct`/`approval`). `publish_site`/`rollback_to_version`
also require an `Idempotency-Key` header (`lib/idempotency.ts`, replay window 24h, Postgres-backed)
regardless of `publish_mode`; rate limits are enforced per-token in `requireAgentScope`
(`lib/rateLimit.ts`: 120 reads/min, 20 writes/min, 5 publishes/min).

## Host-based routing & custom domains (PRD v2.0 R3, partial — CD-20/CD-21)

**Host-based routing (CD-20)** is config-gated and a no-op by default — this deployment doesn't own
any particular domain out of the box, so `{slug}.<apex>`/`{deploymentId}.<previewApex>` synthetic
subdomains only activate when `MICROBUILD_APEX_DOMAIN`/`MICROBUILD_PREVIEW_APEX_DOMAIN` are set.
`middleware.ts` (Edge runtime, no experimental config needed — deliberately dependency-free: no
database access, no Node-only APIs) rewrites any request whose Host header isn't this app's own
canonical host to `/mbhost/*`; that plain `nodejs`-runtime route does the actual resolution (apex
patterns first, then a `site_domains` lookup for a verified custom domain) and delegates to
`lib/siteServing.ts`/`lib/previewServing.ts` — the same functions the path-based `/s/[slug]/...`
routes call, extracted specifically so the two entry points can't drift. See the two pitfalls
already hit and fixed, noted next to the route in "Key Routes" above, before touching either file.

**Custom domains (CD-21)** are real and don't depend on owning any apex domain — the standard
"CNAME your domain to us" pattern every hosting product uses. `lib/domains.ts`: `addCustomDomain`
generates the exact DNS records to create (`CNAME` for a subdomain pointed at this deployment's own
hostname; `ALIAS/ANAME` guidance for an apex domain, which can't use a `CNAME` per the DNS spec;
`TXT _microbuild-challenge.<hostname>` for the ownership challenge) and stores a snapshot of them
on the `site_domains` row so re-fetching never hands back different values than what the operator
was told to create. `verifyCustomDomain` re-checks the TXT record via Node's real `dns.resolveTxt`
— idempotent, safe to poll. 5 domains per site (flat cap, not yet plan-tiered — PRD §10's
per-plan domain counts are part of R5's billing v2, not implemented here). Certificate issuance
(`cert_status`) is bookkeeping-only in this release: `site_domains.cert_status` stays `'none'`
forever until CD-22 (a later release) actually wires up ACME — the Domains UI shows the field as-is
rather than hiding it, so it never silently lies once real values start appearing.

## Scope

**Shipped (MVP + v1.0):** multi-page `.html` upload (multipart + presigned), login-walled viewing (Google/GitHub), per-site allowlists, public link mode, TTL presets + notifications (T-48h/T-2h email + bell), trash/restore/purge via cron, versioning + rollback, teams/workspaces with roles/invites/audit/billing (Stripe), max-TTL policy, token REST API, dashboard/trash/plans/api-cli pages.

**Built, behind flags (PRD v2.0 R0+R1+R2):** MCP server + 18 agent tools, OAuth 2.1 (auth-code+PKCE +
device-code) for agents, scoped `agent_tokens`, preview deployments (with password/organization/
hybrid access modes), deployment state machine, Agent Console UI, Postgres-backed rate
limiting/idempotency, content-addressed storage primitives (`lib/cas.ts`, not yet wired into any
publish path), a workspace publish-approval gate + inbox UI, and (unflagged, deliberately
user-facing) anonymous no-signup trial publish + claim. See "Agent Gateway" above.

**Built, config-gated (PRD v2.0 R3, partial):** host-based routing (`middleware.ts`, config-gated,
no-op when unconfigured) and real custom domains — add/verify/remove, DNS record generation,
`dns.resolveTxt` verification, a Domains panel at `/sites/[id]/domains`, 3 more agent tools (21
total). See "Host-based routing & custom domains" above.

**Still out (v1.1+ / PRD v2.0 R3+):** certificate issuance (CD-22 — `site_domains.cert_status` is
bookkeeping-only today, no real ACME wired up), the visitor-insights pipeline + `get_site_insights`
(CD-23/CD-24), dedicated CLI package (`@microbuild/cli` — the human-facing v1 API already exists;
`@microbuild/mcp` is the agent-facing one), custom SSO (SAML/OIDC, M3), rate limiting on the v1 API
(the *agent* API is rate-limited; v1 is not), anonymous-view event retention sweep, version diffs,
build pipeline, an admin UI for changing a workspace's `publish_mode` or per-plan domain limits
(DB/API only today).

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
CRON_SECRET=                          # also gates /api/admin/backfill-deployments + cleanup phase 5
MICROBUILD_FLAG_AGENT_GATEWAY=false
MICROBUILD_FLAG_AGENT_OAUTH=false
MICROBUILD_FLAG_AGENT_CONSOLE_UI=false
MICROBUILD_FLAG_DEPLOYMENT_SERVING=false
MICROBUILD_BASE_URL=                  # packages/mcp-server: which deployment to talk to
# CD-15 through CD-19 add no new env vars: publish_mode lives in the
# workspaces table (DB/API-set only, no admin UI yet), preview access modes
# and guest publish need no flag at all (see "Agent Gateway" above).

# Host-based routing (PRD v2.0 CD-20) — optional, unset = feature inactive
# (custom domains via site_domains still work either way; these only
# control the synthetic {slug}.<apex> / {deploymentId}.<previewApex> path).
MICROBUILD_APEX_DOMAIN=               # e.g. mb.build — do not set unless you actually own it
MICROBUILD_PREVIEW_APEX_DOMAIN=       # e.g. preview.mb.build
```
