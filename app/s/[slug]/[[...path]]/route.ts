import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { query, type SiteRow } from "@/lib/db";
import { getObject } from "@/lib/storage";
import { canViewSite } from "@/lib/authz";
import { track } from "@/lib/events";
import { isFlagEnabled } from "@/lib/flags";
import { resolveProductionServingKey } from "@/lib/deployments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string; path?: string[] }> },
) {
  const { slug, path } = await params;

  // 1. Look up a live (non-deleted, non-expired) site. The lookup precedes
  //    the session gate so public sites can serve without a login wall; a
  //    404 leaks nothing new (anonymous viewers got a redirect-then-404
  //    before, an existence signal either way).
  const rows = await query<SiteRow>(
    `SELECT * FROM sites
      WHERE slug = $1 AND deleted_at IS NULL AND expires_at > now()
      LIMIT 1`,
    [slug],
  );
  const site = rows[0];
  if (!site) {
    return new NextResponse("Not found or expired", { status: 404 });
  }

  // 2. Session gate: anonymous viewers are allowed through for public sites
  //    only; everyone else is sent to sign-in and returned here afterward.
  const session = await auth();
  const email = session?.user?.email;
  if (!email && site.visibility !== "public") {
    const callbackUrl = new URL(req.url).pathname;
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", callbackUrl);
    return NextResponse.redirect(loginUrl);
  }

  // 3. Authorize via the central policy (owner / allowlist / team / public).
  const lower = email?.toLowerCase() ?? null;
  const isOwner = lower !== null && site.owner_email.toLowerCase() === lower;
  if (lower && !(await canViewSite(site, lower))) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  // 4. Resolve the object key. MVP stores a single index.html; sub-paths are
  //    supported for forward-compatibility with multi-file sites. Behind the
  //    deployment_serving flag (PRD v2.0 CD-14), resolve via the versions/
  //    deployments model instead of sites.s3_prefix directly — self-healing
  //    to the legacy columns on any inconsistency, so this is provably a
  //    no-op in what gets served either way (see resolveProductionServingKey's
  //    doc comment in lib/deployments.ts).
  const flagOn = await isFlagEnabled("deployment_serving", site.workspace_id);
  const { prefix, indexKey } = flagOn
    ? await resolveProductionServingKey(site)
    : { prefix: site.s3_prefix, indexKey: site.index_key };

  const subPath = (path || []).join("/");
  const key = subPath ? `${prefix}${subPath}` : indexKey;

  const object = await getObject(key);
  if (!object) {
    return new NextResponse("Not found", { status: 404 });
  }

  // First-party analytics: record the page view (never blocks serving).
  // Dashboard thumbnail previews (?preview=1) by the owner are not real
  // views and would drown the stats — skip them. Non-owners are always
  // counted regardless of the flag.
  const isPreview = new URL(req.url).searchParams.get("preview") === "1";
  if (!(isPreview && isOwner)) {
    await track("site_view", {
      siteId: site.id,
      workspaceId: site.workspace_id ?? undefined,
      actor: lower ?? undefined,
      meta: { path: subPath || "index", owner: isOwner, anonymous: !lower },
    });
  }

  // 5. Serve with a sandboxing content-security policy. Self-contained pages
  //    (inline styles/scripts, embedded/data images) render; cross-origin
  //    exfiltration and framing are constrained.
  const headers = new Headers();
  headers.set("Content-Type", object.contentType);
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  if (site.visibility === "public") {
    // Public means "anyone with the link", not "findable" — keep crawlers out.
    headers.set("X-Robots-Tag", "noindex, nofollow");
  }
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
