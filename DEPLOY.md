# Deploying to Vercel

The order matters: **deploy first with no auth config** to obtain your
production domain, because the Google OAuth redirect URI requires that domain.
Wiring Google before you have a domain is doing it backwards.

```
1. First deploy (zero env)  →  gives you https://YOUR-DOMAIN
2. Backing services         →  Neon Postgres + S3 bucket
3. Google OAuth             →  needs YOUR-DOMAIN from step 1
4. Env vars + redeploy      →  fully working app
```

---

## 1. First deploy — get the domain

1. Go to **https://vercel.com/new** and import `danielmschaves/microsite-hosting`
   (sign in with GitHub if prompted).
2. Framework preset auto-detects **Next.js**. Leave all defaults. **Deploy.**
3. When it finishes, copy the production domain from the dashboard
   (e.g. `microsite-hosting.vercel.app`). This is `YOUR-DOMAIN` everywhere below.

The app is built to boot with zero configuration: startup skips DB/bucket setup
when unconfigured, and the landing page renders with a "no sign-in methods
configured" notice. That's expected at this stage.

## 2. Backing services

Vercel doesn't run the docker-compose Postgres/MinIO — production needs hosted
equivalents.

**Postgres (Neon, free tier)**
1. https://neon.tech → create project (pick a region near your users).
2. Copy the connection string (`postgres://...neon.tech/neondb?sslmode=require`).
   That's `DATABASE_URL`. The schema creates itself on first boot — no manual
   migration step.

**S3 bucket (AWS)**
1. Create a bucket, e.g. `shipsite-prod`, in a region of your choice.
   Keep **Block all public access ON** — the app streams content itself;
   nothing is ever read publicly from S3.
2. Create an IAM user with an inline policy granting
   `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject`, `s3:ListBucket`
   on `arn:aws:s3:::shipsite-prod` and `arn:aws:s3:::shipsite-prod/*`.
3. Create an access key → `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`.
4. `S3_ENDPOINT` stays **empty** (empty = real AWS). `S3_REGION` = the bucket's
   region, `S3_BUCKET` = its name.

**Secrets** — generate two random strings (e.g. `openssl rand -base64 32`):
`AUTH_SECRET` and `CRON_SECRET`.

## 3. Google OAuth — now that you have the domain

1. https://console.cloud.google.com → create/select a project.
2. **APIs & Services → OAuth consent screen**: User type **External**; fill app
   name + support/developer emails; add no extra scopes; save.
3. **Publish** the consent screen (Publishing status → *In production*). With
   only the default `openid/email/profile` scopes this requires no Google
   verification review — any Google account can sign in immediately.
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Type: **Web application**
   - Authorized JavaScript origins: `https://YOUR-DOMAIN`
   - Authorized redirect URIs: `https://YOUR-DOMAIN/api/auth/callback/google`
5. Copy **Client ID** → `AUTH_GOOGLE_ID`, **Client secret** → `AUTH_GOOGLE_SECRET`.

(GitHub is the same shape later: OAuth app with callback
`https://YOUR-DOMAIN/api/auth/callback/github` → `AUTH_GITHUB_ID`/`_SECRET`.)

## 4. Env vars + redeploy

Vercel project → **Settings → Environment Variables**, scope **Production**:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Neon connection string |
| `S3_BUCKET` | e.g. `shipsite-prod` |
| `S3_REGION` | bucket region, e.g. `us-east-1` |
| `S3_ACCESS_KEY_ID` | IAM access key |
| `S3_SECRET_ACCESS_KEY` | IAM secret |
| `AUTH_SECRET` | random 32-byte string |
| `CRON_SECRET` | random 32-byte string |
| `AUTH_GOOGLE_ID` | from step 3 |
| `AUTH_GOOGLE_SECRET` | from step 3 |
| `AUTH_URL` | `https://YOUR-DOMAIN` |
| `NEXT_PUBLIC_BASE_URL` | `https://YOUR-DOMAIN` |

Do **not** set `S3_ENDPOINT` (MinIO-only) and **never** set `AUTH_DEV_LOGIN` in
production — it would let anyone sign in as anyone.

Then **Deployments → ⋯ → Redeploy**. A redeploy is required:
`NEXT_PUBLIC_BASE_URL` is embedded at build time.

### Verify

- `https://YOUR-DOMAIN/` → landing shows **Continue with Google**
- Sign in → dashboard loads (proves DB works)
- Upload an HTML file → link works (proves S3 works)
- Open the link in a private window → login wall; sign in as a non-allowlisted
  account → 403
- Function logs show `[startup] database schema ready` / `storage bucket ready`

## Optional services (v1.0 features)

All optional — absent env vars degrade gracefully (no email → invite copy-links;
no Stripe → everything is free tier).

**Resend (team invite emails):** create an API key at https://resend.com, verify
a sender domain, set `RESEND_API_KEY` + `EMAIL_FROM` (e.g.
`MicroBuild <invites@yourdomain.com>`).

**Stripe (Team plan billing):**
1. Create a product "MicroBuild Team" with a recurring per-seat price
   (~$5/user/month) → copy the price id → `STRIPE_TEAM_PRICE_ID`.
2. `STRIPE_SECRET_KEY` from API keys.
3. Add a webhook endpoint `https://YOUR-DOMAIN/api/stripe/webhook` listening to:
   `checkout.session.completed`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted`,
   `invoice.payment_failed` → copy the signing secret → `STRIPE_WEBHOOK_SECRET`.
4. Local testing: `stripe listen --forward-to localhost:3000/api/stripe/webhook`
   (use the CLI's printed webhook secret), or skip Stripe entirely with
   `PLAN_FAKE_TEAM=true` (dev-only; hard-blocked in production).

## Platform limits worth knowing

- **Upload size:** Vercel serverless functions cap request bodies at ~4.5 MB.
  Uploads above that get a platform-level 413 regardless of `MAX_UPLOAD_BYTES`.
  Fine for typical self-contained HTML; the v1.0 fix is pre-signed S3 upload
  URLs (PRD §9) so files bypass the function entirely.
- **Cron:** `vercel.json` schedules cleanup daily at 03:00 UTC (Hobby tier
  allows only daily crons). Expired sites stop being *served* at the exact
  expiry moment regardless — the daily job only lags the storage deletion.
  On a Pro plan you can tighten the schedule.
- **OAuth on previews:** preview deployments get random URLs that aren't in
  Google's redirect allowlist — test sign-in on the production domain.
