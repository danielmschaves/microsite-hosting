import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { query, type DeploymentRow, type SiteRow, type VersionRow } from "@/lib/db";
import { getObject } from "@/lib/storage";
import { canViewSite } from "@/lib/authz";
import { track } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Preview deployment serving (PRD v2.0 CD-03). Structurally mirrors
// app/s/[slug]/[[...path]]/route.ts but resolves the object key from a
// `deployments` row instead of the site's live sites.s3_prefix — this is the
// first route that serves content not yet promoted to the live site. Never a
// way to view non-preview-authorized content: gated on the *site's* own
// visibility (same canViewSite policy as production) AND
// deployments.status='ready' AND target='preview'. Deployment ids are UUIDs
// (gen_random_uuid()), so there is no enumeration risk beyond what already
// exists for sites.id.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string; deploymentId: string; path?: string[] }> },
) {
  const { slug, deploymentId, path } = await params;

  const siteRows = await query<SiteRow>(
    "SELECT * FROM sites WHERE slug = $1 AND deleted_at IS NULL",
    [slug],
  );
  const site = siteRows[0];
  if (!site) {
    return new NextResponse("Not found", { status: 404 });
  }

  const deploymentRows = await query<DeploymentRow>(
    `SELECT * FROM deployments
      WHERE id = $1 AND site_id = $2 AND target = 'preview' AND status = 'ready'`,
    [deploymentId, site.id],
  );
  const deployment = deploymentRows[0];
  if (!deployment) {
    return new NextResponse("Preview not found or not ready", { status: 404 });
  }

  const session = await auth();
  const email = session?.user?.email;
  if (!email && site.visibility !== "public") {
    const callbackUrl = new URL(req.url).pathname;
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", callbackUrl);
    return NextResponse.redirect(loginUrl);
  }

  const lower = email?.toLowerCase() ?? null;
  if (lower && !(await canViewSite(site, lower))) {
    return new NextResponse("Forbidden", { status: 403 });
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
