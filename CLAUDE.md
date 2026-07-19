# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Status

Pre-implementation phase. The full specification is in `PRD.md`. No source code exists yet — the next step is building the MVP described in PRD §8.

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

## Expected Commands (once scaffolded)

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

- `/s/[slug]/[...path]` — Authenticated content serving (stream from S3 after auth check)
- `/api/upload` — POST: accept HTML file, store to S3, write metadata to Postgres
- `/api/cleanup` — GET/POST: cron-callable; deletes expired sites from S3 + soft-deletes in DB
- `/dashboard` — Authenticated UI: list sites, copy link, extend TTL, delete

## Data Model (core tables)

- `sites` — slug, owner_id, s3_key_prefix, ttl_preset, expires_at, deleted_at, visibility
- `site_viewers` — site_id, viewer_email (the allowlist)
- `users` — id, email, provider, created_at

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
