# PRD — Microsite Hosting Platform (working name: "Shipsite")

**Status:** Draft v0.2
**Author:** Daniel
**Last updated:** July 2026

---

## 1. Problem Statement

Teams constantly produce standalone HTML artifacts — data reports, prototypes, dashboards, AI-generated pages, documentation exports. Today, sharing them means attaching files to Slack or email, forcing every recipient to download the file and open it locally. This workflow breaks previews, loses versions, leaks files outside team control, and makes "just look at this page" a multi-step chore.

There is no lightweight, secure, self-expiring way to publish an HTML file and hand a teammate a link.

## 2. Product Vision

A dead-simple hosting platform where anyone can drag an HTML file (or small static bundle) into a browser, get a shareable URL protected by their team's SSO, and trust that the site cleans itself up after a configurable TTL. Zero infrastructure knowledge required. Upload → link → done.

## 3. Goals & Non-Goals

### Goals
- Reduce time from "I have an HTML file" to "teammate is viewing it" to under 30 seconds.
- Every shared site is access-controlled by default (SSO), never public by accident.
- Automatic lifecycle management: sites expire via TTL, no orphaned content.
- Monetizable from day one: free personal tier, low-cost team tier.

### Non-Goals (v1)
- Not a general web host: no server-side code, no databases, no build pipelines.
- No custom domains for hosted sites in v1 (platform subdomain only).
- No CI/CD integrations in v1 (API exists, but GitHub Actions etc. come later).
- Not a replacement for Vercel/Netlify — this targets ephemeral internal sharing, not production apps.

## 4. Target Users & Personas

**Priya — Data Analyst (primary).** Exports Plotly/Observable reports as HTML weekly. Wants stakeholders to click a link, not download attachments. Cares about access control because reports contain client data.

**Marco — Delivery/Product Manager.** Receives AI-generated artifacts, prototypes, and one-page summaries. Wants a single place where the team's shared pages live, with visibility into what exists and when it expires.

**Solo builder — free tier.** Hobbyist or consultant sharing quick prototypes with clients. Tolerates platform branding and tighter limits; converts to paid when a team forms around them.

## 5. User Stories

1. As a team member, I can drag-and-drop an `.html` file and receive a live URL within seconds.
   - *(1.0+)* I can drop several `.html` files at once and mark which one is the index, publishing them as a single multi-page site.
2. As an uploader, I can set a TTL (1 day / 7 days / 30 days / custom) at upload time and change it later.
3. As a viewer, when I open a shared link I authenticate via my team's SSO and see the page — no downloads.
4. As an uploader, I can choose the audience per site: only me, my team, or specific teammates.
5. As a team admin, I can see all active sites, who owns them, storage used, and force-expire anything.
6. As an uploader, I receive a notification before my site expires, with a one-click "extend" action.
7. As a paid team admin, I can connect our identity provider (Google Workspace, Microsoft Entra, Okta via SAML/OIDC) so links are protected by our own SSO.
8. As a developer, I can upload via a simple authenticated API/CLI (`shipsite deploy report.html --ttl 7d`).

## 6. Functional Requirements

### 6.1 Upload & Hosting
- Accept single `.html` files (self-contained pages, typically AI-generated). No zip/bundle support. Max 25 MB free / 250 MB team per site.
- **1.0+:** multi-page sites via multiple `.html` files uploaded together, with the entry page clearly identified — auto-detect `index.html`, otherwise the uploader explicitly marks one file as the index in the UI. Pages served at `/{slug}/` (index) and `/{slug}/{page}.html`.
- Serve over HTTPS from a platform subdomain: `{slug}.sites.shipsite.app` or path-based `sites.shipsite.app/{team}/{slug}`.
- Auto-generated human-readable slugs, editable before publishing.
- Re-upload to the same slug creates a new version; last 5 versions retained (team tier), instant rollback.
- Content sandboxing: strict CSP headers, no server-side execution, uploads scanned for size/type.

### 6.2 Access Control
- All sites private by default. Access enforced server-side (auth check before content is served, not client-side).
- Free tier: sign-in with Google/GitHub/email magic link; sharing via invited email addresses.
- Team tier: workspace membership grants access to team-visibility sites; per-site overrides (specific members, link-with-login).
- Paid roadmap: bring-your-own IdP (SAML 2.0 / OIDC), SCIM provisioning later.
- Optional "anyone with the link" mode is a deliberate, admin-toggleable feature — off by default, watermarked in UI as public.

### 6.3 TTL & Lifecycle
- TTL presets (24h, 7d, 30d) plus custom; team admins can set a max-TTL policy.
- Expiry notifications at T-48h and T-2h (email + in-app) with one-click extend.
- Expired sites move to a 7-day soft-delete "trash" (restorable), then hard-deleted from storage.
- Dashboard shows countdown badges per site.

### 6.4 Dashboard
- List/grid of my sites and team sites: thumbnail preview, owner, URL, TTL countdown, visibility, size.
- Actions: copy link, extend TTL, change visibility, delete, view versions.
- Team admin view: usage totals, member management, audit log (uploads, access changes, deletions).

### 6.5 API & CLI (v1.1)
- Token-based REST API: create site, upload content, set TTL, delete.
- Thin CLI wrapper for scripted/CI usage.

## 7. Pricing & Packaging

| | **Free (Personal)** | **Team** | **Later: Business** |
|---|---|---|---|
| Price | $0 | ~$5/user/mo (min 3 seats) | TBD |
| Active sites | 5 | 100/workspace | Custom |
| Max site size | 25 MB | 250 MB | Custom |
| Max TTL | 7 days | 90 days | Unlimited + policies |
| Auth for viewers | Google/GitHub/magic link | Workspace membership | **Own-domain SSO (SAML/OIDC)** |
| Versions | 1 | 5 | Unlimited |
| Audit log | — | 30 days | 1 year |
| API/CLI | — | ✓ | ✓ |

Positioning: free tier is a growth loop (viewers hit a login wall → sign up → upload their own sites → form teams). Own-domain SSO is the anchor feature for the Business tier upsell, consistent with standard B2B SaaS packaging.

## 8. MVP Approach (v0) — Minimal Infrastructure

**Principle:** validate the core loop (upload → authenticated link → auto-expiry) with the least infrastructure possible, on free tiers, built with Claude Code against a written goal. No CDN, no edge functions, no dedicated auth infrastructure. Everything containerized in Docker until architecture decisions for 1.0 are made — the Vercel deploy is a convenience target, not a dependency.

### 8.1 MVP Stack

| Concern | MVP choice | Why |
|---|---|---|
| App + hosting | **Next.js on Vercel** (Hobby/free tier) | One deploy surface for UI, API routes, and content serving |
| Storage | **Single S3 bucket** (private, one prefix per site) or Vercel Blob as fallback | Simplest possible object store; S3 keeps the 1.0 path open |
| Auth | **Auth.js (NextAuth)** with Google + GitHub OAuth | Free, session cookies out of the box, swappable later |
| Database | **Neon Postgres free tier** (or SQLite in the Docker container for local) | Site metadata, TTLs, ownership |
| TTL sweep | **Vercel Cron** hitting an internal cleanup route | No workers, no queues |
| Content serving | **Authenticated Next.js route handler** (`/s/[slug]/[...path]`) streaming from S3 | Auth enforced in-app; no CloudFront/Lambda@Edge needed |
| Local dev | **docker-compose**: app + Postgres + MinIO (S3-compatible) | Full stack runs offline; no cloud account needed to develop |

### 8.2 MVP Scope (in)
- Upload single `.html` file via drag-and-drop → private URL.
- Login required to view (Google/GitHub); uploader can allowlist viewer emails.
- TTL presets (24h / 7d / 30d) + hard delete on expiry via cron.
- Minimal dashboard: my sites, copy link, delete, TTL countdown.

### 8.3 MVP Scope (out — deferred to 1.0)
- Teams/workspaces, admin views, audit log, billing, multi-page sites (multiple HTML files with identified index), versioning, notifications, API/CLI, custom SSO, subdomain-per-site.

### 8.4 Docker Constraint
- The entire application must run via `docker compose up` with zero cloud dependencies (MinIO stands in for S3, local Postgres for Neon). Cloud services are injected only through environment variables.
- Rationale: keeps the MVP portable and defers the Vercel-vs-AWS 1.0 hosting decision. Nothing in the codebase may assume Vercel-only primitives except behind an adapter (storage, cron trigger, auth callbacks).
- The same Docker image should be deployable to any container host if Vercel is dropped.

### 8.5 Claude Code Build Goal (draft)
> Build a Next.js app ("Shipsite MVP") that lets an authenticated user upload a single HTML file, stores it in S3-compatible storage, serves it at `/s/{slug}` only to logged-in allowed users, and deletes it after its TTL. Include docker-compose (app + Postgres + MinIO), Auth.js with Google/GitHub, a cron-callable cleanup endpoint, and a minimal dashboard. All external services configurable via env vars.

### 8.6 Exit Criteria (MVP → 1.0 decision)
- Core loop works end-to-end for ≥ 10 real users / 2 weeks.
- Evidence that the login wall is acceptable to viewers (not a drop-off cliff).
- Storage/serving costs and route-handler latency measured → informs whether 1.0 needs CloudFront edge auth or the in-app model scales.

## 9. Target Architecture — v1.0

- **Storage:** AWS S3 (private buckets, one prefix per workspace/site/version). S3 lifecycle rules as a safety net behind application-level TTL deletion.
- **Delivery:** CloudFront in front of S3; **Lambda@Edge / CloudFront Functions** validate a signed session cookie/JWT on every request — content is never publicly readable from S3 directly (Origin Access Control).
- **Auth:** Managed auth provider (e.g., Cognito/Auth0/WorkOS) issuing sessions; WorkOS-style abstraction recommended to make later SAML/OIDC "bring your own IdP" a config change rather than a rebuild.
- **App backend:** Lightweight API (uploads via S3 pre-signed URLs so files never transit the app server), metadata in Postgres (sites, TTLs, memberships, audit events), scheduled job for expiry sweep + notifications.
- **TTL enforcement:** DB is the source of truth; expiry worker revokes edge access immediately at expiry, deletes objects after the trash window.
- **Migration path from MVP:** storage adapter already points at S3; auth swaps from Auth.js social login to the managed provider; content serving moves from route handler to CloudFront + edge auth; Docker images redeploy to ECS/Fargate or stay on Vercel for the app layer — decided using MVP cost/latency data.

## 10. Success Metrics

- **Activation:** % of new users who publish a site within 10 minutes of signup (target ≥ 60%).
- **Core loop:** median time upload → first external view (target < 5 min).
- **Retention:** weekly uploading users; sites per active team per month.
- **Conversion:** free viewer → registered user rate; workspace free → paid conversion (target ≥ 5% at 90 days).
- **Trust:** zero incidents of unauthorized content access; % of sites expiring cleanly without manual cleanup.

## 11. Risks & Mitigations

- **Abuse (phishing/malware hosting):** private-by-default + login wall drastically reduces abuse surface; file-type allowlist, CSP, abuse reporting, rate limits on free tier.
- **Route-handler serving cost/latency (MVP):** every page view transits a serverless function; acceptable at MVP scale, measured explicitly as an exit criterion before 1.0.
- **Vercel free-tier limits:** Hobby tier bandwidth/function limits cap MVP scale — fine for validation, and the Docker constraint guarantees an exit path.
- **"Why not just use Netlify Drop / S3 static hosting?"** Differentiation is the combination: SSO-gated by default + TTL + team dashboard. Keep messaging anchored on *secure ephemeral internal sharing*.
- **Data sensitivity:** encryption at rest (SSE-S3/KMS), regional storage choice for teams (LGPD/GDPR), audit log.

## 12. Milestones

- **M0 — MVP (Claude Code build):** Section 8 scope; Vercel + S3/MinIO + Auth.js + Docker; validate core loop with real users.
- **M1 — 1.0 foundation:** decision gate on Section 8.6 data → teams/workspaces, versioning, notifications, multi-page sites (index-identified HTML files), billing scaffolding.
- **M2 — Launch:** free + team tiers live, soft-delete/trash, dashboard admin views.
- **M3 — Business tier:** own-domain SSO (SAML/OIDC via auth abstraction), max-TTL policies, extended audit.

## 13. Open Questions

1. Subdomain-per-site vs. path-based URLs? (MVP uses path-based; subdomains isolate cookies/CSP better but need wildcard cert + slug governance.)
2. Should free-tier sites carry a small platform badge/banner?
3. S3 from day one, or Vercel Blob for MVP with the storage adapter hiding the difference?
4. Is "anyone with the link" (unauthenticated) ever allowed on free tier, or paid-only?
5. Regional data residency (e.g., sa-east-1 option) at launch or later?
6. For 1.0 app hosting: stay on Vercel or move containers to AWS (ECS/Fargate) alongside CloudFront? (Decide with MVP cost data.)