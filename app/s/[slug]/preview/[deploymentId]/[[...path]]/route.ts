import { NextResponse } from "next/server";
import argon2 from "argon2";
import { auth } from "@/auth";
import { query, type DeploymentRow, type SiteRow, type VersionRow } from "@/lib/db";
import { getObject } from "@/lib/storage";
import { canViewSite } from "@/lib/authz";
import { getMembership } from "@/lib/teams";
import { track } from "@/lib/events";
import {
  parseCookies,
  previewCookieName,
  signPreviewAccess,
  verifyPreviewAccess,
  PREVIEW_COOKIE_MAX_AGE_SECONDS,
} from "@/lib/previewAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function findSiteAndReadyPreview(
  slug: string,
  deploymentId: string,
): Promise<{ site: SiteRow; deployment: DeploymentRow } | null> {
  const siteRows = await query<SiteRow>(
    "SELECT * FROM sites WHERE slug = $1 AND deleted_at IS NULL",
    [slug],
  );
  const site = siteRows[0];
  if (!site) return null;

  const deploymentRows = await query<DeploymentRow>(
    `SELECT * FROM deployments
      WHERE id = $1 AND site_id = $2 AND target = 'preview' AND status = 'ready'`,
    [deploymentId, site.id],
  );
  const deployment = deploymentRows[0];
  if (!deployment) return null;
  return { site, deployment };
}

function passwordForm(opts: { action: string; error?: string }): NextResponse {
  const html = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Preview password</title>
<style>body{font-family:system-ui,sans-serif;background:#0b0b0f;color:#eee;display:grid;place-items:center;min-height:100vh;margin:0}
form{background:#16161d;border:1px solid #2a2a35;border-radius:12px;padding:28px;width:min(340px,90vw)}
h1{font-size:15px;margin:0 0 14px}input{width:100%;box-sizing:border-box;padding:10px 12px;border-radius:8px;border:1px solid #333;background:#0f0f14;color:#eee;font-size:14px;margin-bottom:12px}
button{width:100%;padding:10px;border-radius:8px;border:none;background:#5b4dff;color:#fff;font-weight:600;font-size:14px;cursor:pointer}
p.err{color:#ff8080;font-size:12.5px;margin:-4px 0 12px}</style>
</head><body>
<form method="POST" action="${opts.action}">
<h1>This preview is password-protected</h1>
${opts.error ? `<p class="err">${opts.error}</p>` : ""}
<input type="password" name="password" placeholder="Password" autofocus required>
<button type="submit">Continue</button>
</form>
</body></html>`;
  return new NextResponse(html, {
    status: 401,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

// Preview deployment serving (PRD v2.0 CD-03/CD-15). Structurally mirrors
// app/s/[slug]/[[...path]]/route.ts but resolves the object key from a
// `deployments` row instead of the site's live sites.s3_prefix — this is the
// first route that serves content not yet promoted to the live site. Gated
// on deployments.status='ready' AND target='preview', PLUS the deployment's
// own access_mode (CD-15): "inherit" (default) keeps the exact pre-CD-15
// behavior — the site's own canViewSite policy; "organization" requires
// workspace membership regardless of the site's own visibility;
// "password"/"hybrid" require a signed cookie proving a prior password
// check (see lib/previewAccess.ts) — the plaintext password is never
// stored anywhere but the argon2id hash on the deployment row.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string; deploymentId: string; path?: string[] }> },
) {
  const { slug, deploymentId, path } = await params;

  const found = await findSiteAndReadyPreview(slug, deploymentId);
  if (!found) {
    return new NextResponse("Preview not found or not ready", { status: 404 });
  }
  const { site, deployment } = found;

  const session = await auth();
  const email = session?.user?.email;
  const lower = email?.toLowerCase() ?? null;

  if (deployment.access_mode === "organization" || deployment.access_mode === "hybrid") {
    if (!lower) {
      const callbackUrl = new URL(req.url).pathname;
      const loginUrl = new URL("/login", req.url);
      loginUrl.searchParams.set("callbackUrl", callbackUrl);
      return NextResponse.redirect(loginUrl);
    }
    const member = site.workspace_id ? await getMembership(lower, site.workspace_id) : null;
    if (!member) {
      return new NextResponse("Forbidden", { status: 403 });
    }
  }

  if (deployment.access_mode === "password" || deployment.access_mode === "hybrid") {
    const cookies = parseCookies(req.headers.get("cookie"));
    const cookieValue = cookies[previewCookieName(deploymentId)];
    if (!cookieValue || !verifyPreviewAccess(cookieValue, deploymentId)) {
      return passwordForm({ action: new URL(req.url).pathname });
    }
  }

  if (deployment.access_mode === "inherit") {
    if (!lower && site.visibility !== "public") {
      const callbackUrl = new URL(req.url).pathname;
      const loginUrl = new URL("/login", req.url);
      loginUrl.searchParams.set("callbackUrl", callbackUrl);
      return NextResponse.redirect(loginUrl);
    }
    if (lower && !(await canViewSite(site, lower))) {
      return new NextResponse("Forbidden", { status: 403 });
    }
  }

  const versionRows = await query<VersionRow>("SELECT * FROM versions WHERE id = $1", [
    deployment.version_id,
  ]);
  const version = versionRows[0];
  if (!version) {
    return new NextResponse("Preview content not found", { status: 404 });
  }

  const prefix = version.storage_key;
  const subPath = (path || []).join("/");
  const key = subPath ? `${prefix}${subPath}` : `${prefix}index.html`;

  const object = await getObject(key);
  if (!object) {
    return new NextResponse("Not found", { status: 404 });
  }

  await track("site_view", {
    siteId: site.id,
    workspaceId: site.workspace_id ?? undefined,
    actor: lower ?? undefined,
    meta: { path: subPath || "index", preview: true, deploymentId, anonymous: !lower },
  });

  const headers = new Headers();
  headers.set("Content-Type", object.contentType);
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Robots-Tag", "noindex, nofollow");
  headers.set("X-Frame-Options", "SAMEORIGIN");
  headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "img-src 'self' data: https:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self' 'unsafe-inline'",
      "font-src 'self' data: https:",
      "frame-ancestors 'self'",
      "base-uri 'none'",
      "form-action 'self'",
    ].join("; "),
  );

  return new NextResponse(Buffer.from(object.body), { status: 200, headers });
}

// POST — password-form submission for "password"/"hybrid" access modes.
// Verifies against the argon2id hash on the deployment row, then sets the
// signed proof-of-access cookie and 303-redirects back to the same path (so
// a resubmit never re-POSTs). "organization"/"hybrid" membership and
// "inherit" visibility are still enforced by GET on the redirected request —
// this only ever grants the password half of the check.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string; deploymentId: string; path?: string[] }> },
) {
  const { slug, deploymentId } = await params;

  const found = await findSiteAndReadyPreview(slug, deploymentId);
  if (!found) {
    return new NextResponse("Preview not found or not ready", { status: 404 });
  }
  const { deployment } = found;

  const pathname = new URL(req.url).pathname;
  if (deployment.access_mode !== "password" && deployment.access_mode !== "hybrid") {
    return passwordForm({ action: pathname, error: "This preview is not password-protected." });
  }

  const form = await req.formData().catch(() => null);
  const password = form?.get("password");
  if (typeof password !== "string" || !password) {
    return passwordForm({ action: pathname, error: "Enter the password." });
  }

  const ok =
    Boolean(deployment.access_password_hash) &&
    (await argon2.verify(deployment.access_password_hash!, password).catch(() => false));
  if (!ok) {
    return passwordForm({ action: pathname, error: "Incorrect password." });
  }

  const res = NextResponse.redirect(new URL(pathname, req.url), { status: 303 });
  res.cookies.set(previewCookieName(deploymentId), signPreviewAccess(deploymentId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: PREVIEW_COOKIE_MAX_AGE_SECONDS,
    path: `/s/${slug}/preview/${deploymentId}`,
  });
  return res;
}
