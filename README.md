# Shipsite MVP

Ephemeral, SSO-gated HTML hosting. An authenticated user uploads a single
self-contained `.html` file, gets a private link served only to logged-in
allowed viewers, and the site auto-deletes when its TTL expires.

See [`PRD.md`](./PRD.md) for the product spec, [`CLAUDE.md`](./CLAUDE.md) for
architecture notes, and [`DEPLOY.md`](./DEPLOY.md) for the production deploy
runbook (Vercel first, then Google OAuth — in that order).

## Stack

- **Next.js 15** (App Router) — UI, API routes, and auth-gated content serving
- **Auth.js v5** — Google + GitHub OAuth (JWT sessions)
- **Postgres** (`pg`, raw parameterized SQL) — site metadata + viewer allowlist
- **S3-compatible storage** (`@aws-sdk/client-s3`) — AWS S3 in prod, MinIO locally
- **docker-compose** — app + Postgres + MinIO, runs fully offline

The schema and storage bucket are created automatically on server startup
(`instrumentation.ts`), so there's no separate migration step.

## Run locally with Docker

```bash
docker compose up --build
```

Then open http://localhost:3000. No `.env` is required — the compose file ships
working local defaults (Postgres, MinIO) and enables **dev login**. MinIO console
is at http://localhost:9001 (`minioadmin` / `minioadmin`).

### Dev login (no OAuth setup needed)

`AUTH_DEV_LOGIN=true` (default in docker-compose) adds a "Continue with email"
box on the sign-in screens. Type any email to sign in as that user — ideal for
testing the viewer allowlist. **Never enable it in production.**

Test the full loop:

1. Sign in as `owner@test.com`, go to **New site**, drop any `.html`, add
   `viewer@test.com` to *Allowed viewers*, pick a TTL, publish.
2. Open the site link — it works for you (the owner).
3. Sign out, sign in as `viewer@test.com`, open the link — works (allowlisted).
4. Sign out, sign in as `stranger@test.com`, open the link — **403 Forbidden**.
5. Back on the dashboard, try **Extend TTL** and **Delete**.

### Real OAuth (optional, higher fidelity)

Set the following and restart; the Google/GitHub buttons appear automatically.
Callback URLs:

- Google: `http://localhost:3000/api/auth/callback/google`
- GitHub: `http://localhost:3000/api/auth/callback/github`

## Run without Docker

```bash
npm install
# Point DATABASE_URL and the S3_* vars at a running Postgres and S3/MinIO,
# then:
npm run dev
```

## Endpoints

| Route | Purpose |
|---|---|
| `POST /api/upload` | Upload an HTML file (auth required). Fields: `file`, `ttl` (`24h`/`7d`/`30d`), optional `slug`, optional `viewers` |
| `GET /s/{slug}` | Auth-gated content serving. Owner or allowlisted email only |
| `DELETE /api/sites/{id}` | Owner deletes a site |
| `GET,POST /api/cleanup` | TTL sweep. Requires `Authorization: Bearer $CRON_SECRET` |
| `/dashboard` | List sites, copy link, delete, TTL countdown |

### Triggering cleanup manually

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cleanup
```

On Vercel, `vercel.json` schedules this hourly and sends the `CRON_SECRET`
bearer automatically.

## Configuration

All external services are configured via environment variables — see
[`.env.example`](./.env.example). The same image runs against MinIO/local
Postgres or AWS S3/Neon with no code changes; set `S3_ENDPOINT` to target an
S3-compatible store (blank uses real AWS S3).
