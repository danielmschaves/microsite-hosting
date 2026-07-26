# Shipsite (MicroBuild)

Ephemeral, SSO-gated HTML hosting. Upload one or more self-contained `.html`
pages, get a private link served only to allowed viewers (or, when you flip
the toggle, anyone with the link), and let the site expire on its TTL —
trash for 7 days, then gone. v1.0 adds team workspaces (roles, invites,
audit log, Stripe billing), versioning with instant rollback, expiry
notifications (email + in-app bell), a token-authenticated REST API, and
dedicated trash/plans/API pages.

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

## Key surfaces

| Route | Purpose |
|---|---|
| `/dashboard` | Your sites: grid/list, countdowns, extend/trash, team-shared sites |
| `/sites/{id}` | Site detail: pages + set-as-index, versions + rollback, visibility (incl. public toggle), lifecycle, danger zone |
| `/teams`, `/teams/{id}` | Workspaces: stat tiles, all-team-sites table, members, audit log (CSV export), billing, max-TTL policy |
| `/trash` | Restore or purge trashed sites ("purges in Nd") |
| `/plans` | Free / Team / Business pricing |
| `/api-cli` | Access tokens + REST endpoint reference |
| `GET /s/{slug}[/page.html]` | Content serving — login-walled unless the site is public |
| `POST /api/upload` | Session multipart upload (≤4 MB; browser presigned path has no cap). Re-uploading your own slug publishes a new version |
| `GET,POST /api/cleanup` | Notify (T-48h/T-2h) + trash + purge sweep. `Authorization: Bearer $CRON_SECRET` |

## REST API (tokens)

Create a token on `/api-cli`, then:

```bash
curl -X POST -H "Authorization: Bearer $MICROBUILD_TOKEN" \
  -F file=@report.html -F ttl=7d -F slug=my-report \
  http://localhost:3000/api/v1/sites
```

| Endpoint | Purpose |
|---|---|
| `GET /api/v1/sites` | List your live sites |
| `POST /api/v1/sites` | Create (or republish your own slug) |
| `PUT /api/v1/sites/{slug}/content` | Upload a new version |
| `PATCH /api/v1/sites/{slug}` | `{ttl}` / `{visibility}` / `{slug}` |
| `DELETE /api/v1/sites/{slug}` | Trash (`?permanent=true` purges) |

### Triggering cleanup manually

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cleanup
```

On Vercel, `vercel.json` schedules this daily (Hobby-tier limit) and sends the
`CRON_SECRET` bearer automatically; point an external 15-minute cron at the
same URL for timely T-2h expiry notices (see `DEPLOY.md`).

## Configuration

All external services are configured via environment variables — see
[`.env.example`](./.env.example). The same image runs against MinIO/local
Postgres or AWS S3/Neon with no code changes; set `S3_ENDPOINT` to target an
S3-compatible store (blank uses real AWS S3).
