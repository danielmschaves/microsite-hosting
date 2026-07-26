# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Status

Built and deployed: the MVP (PRD §8) plus the v1.0 feature set (teams/workspaces, billing, multi-page sites, presigned uploads, trash, versioning, token API, public links, expiry notifications). The full specification is in `PRD.md`; the sections below describe what exists in the codebase.

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
npm run build              # Production build
npm run lint               # ESLint
npm test                   # Test suite
```

## Critical Architectural Constraints

**Docker-first portability:** The entire app must run via `docker compose up` with zero cloud dependencies. MinIO substitutes S3; local Postgres substitutes Neon. Cloud services are injected only through environment variables — nothing in the codebase may hard-code Vercel-only primitives.

**Storage adapter pattern:** Abstract S3 operations behind a storage adapter so the backing store (Vercel Blob / AWS S3 / MinIO) is swappable via env var. This is the migration path to v1.0.

**Auth-gated content serving:** All sites are private by default. The route handler at `/s/[slug]/[...path]` must verify Auth.js session and check the viewer allowlist in Postgres *before* streaming any bytes from S3 — never expose S3 URLs directly.

**No Vercel-specific primitives in core logic:** Cron trigger, storage calls, and auth callbacks must be reachable from either a Vercel deployment or a plain Docker container. Use standard Next.js API routes, not Vercel-specific SDK features.

## Key Routes

Pages (App Router):
- `/` — landing / sign-in (redirects to `/dashboard` when authed)
- `/login` — branded login wall; wired as Auth.js `pages.signIn`, so gated `/s/*` viewers land here with `callbackUrl` preserved
- `/dashboard` — site list (grid/list toggle, search, live TTL countdowns, copy/extend/delete)
- `/upload` — "Publish a page": dropzone + config (slug, TTL, viewer allowlist chips) + summary panel
- `/settings` — profile + configured sign-in providers + sign out

- `/sites/[id]` — owner-only manage panel: stats, TTL, slug rename, visibility, viewer allowlist CRUD, pages list, trash/restore/purge
- `/teams`, `/teams/[id]` — workspaces: members/roles/invites, usage, sites table (admin force-expire/trash), audit log (team plan), billing card, max-TTL policy
- `/invite/[token]` — invite acceptance (email-bound, 14d expiry)

API / handlers:
- `/s/[slug]/[[...path]]` — auth-gated content serving (verify session + allowlist, then stream from S3); records a `site_view` event
- `/api/upload` — POST: accepts 1–20 `.html` files (multi-page; `index` field or auto-detected `index.html`), stores under a slug-decoupled S3 prefix (`sites/{slug}-{ts}/`), writes metadata to Postgres
- `/api/sites/[id]` — DELETE (move to trash; `?permanent=true` purges storage) · PATCH (`{ttl}` extend, `{slug}` rename — metadata-only, prefix never moves, `{action:"restore"}` un-trash)
- `/api/sites/[id]/viewers` — GET/POST/DELETE: allowlist CRUD, effective immediately
- `/api/cleanup` — GET/POST, `Authorization: Bearer $CRON_SECRET`: phase 1 trashes expired sites (storage kept); phase 2 purges storage for sites trashed > 7 days; phase 3 purges incomplete presigned uploads > 24h
- `/api/upload/presign` + `/api/upload/complete` — presigned browser→S3 path (no server body cap); `/api/upload` is the ≤4MB multipart fallback; both share `lib/createSite.ts`
- `/api/workspaces[...]` — workspace CRUD, members (owner immovable), invites (admin+), audit (admin+, team plan), billing checkout/portal (owner)
- `/api/invites/[token]` — POST accept (session email must equal invited email)
- `/api/stripe/webhook` — signature-verified; `lib/billing.ts` `syncSubscriptionToWorkspace` is the SOLE writer of plan/seats/status

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

- `sites` — slug, owner_email, s3_prefix, index_key, size_bytes, page_count, ttl_preset, expires_at, deleted_at (= in trash), purged_at (= storage gone, unrestorable)
- `site_viewers` — site_id, viewer_email (the allowlist)
- `events` — first-party analytics (type, site_id, actor, meta jsonb); captured server-side via `lib/events.ts` `track()`; no third-party SDK

Lifecycle: live (`deleted_at IS NULL`, unexpired) → trash (`deleted_at` set, storage kept, restorable) → purged (`purged_at` set after `TRASH_DAYS`). Serving requires live. The S3 prefix embeds a timestamp so trashed sites never collide with a new site reusing the slug.

Auth uses JWT sessions (no DB adapter), so there is no `users` table — the allowlist is matched against the session email.

## MVP Scope

**In:** single `.html` upload, login-required viewing (Google/GitHub), email allowlist per site, TTL presets (24h/7d/30d), hard delete via cron, minimal dashboard.

**Out (deferred to v1.0):** teams/workspaces, admin views, audit log, billing, multi-page sites, versioning, expiry notifications, API/CLI, custom SSO, subdomain-per-site.

## Environment Variables (all required)

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
```
