import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { query, type SiteRow } from "@/lib/db";
import { getObject } from "@/lib/storage";
import { track } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string; path?: string[] }> },
) {
  const { slug, path } = await params;

  // 1. Require a signed-in user. Unauthenticated viewers are sent to sign-in
  //    and returned here afterward.
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    const callbackUrl = new URL(req.url).pathname;
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", callbackUrl);
    return NextResponse.redirect(loginUrl);
  }

  // 2. Look up a live (non-deleted, non-expired) site.
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

  // 3. Authorize: owner always allowed; otherwise must be on the allowlist.
  const lower = email.toLowerCase();
  const isOwner = site.owner_email.toLowerCase() === lower;
  if (!isOwner) {
    const allowed = await query(
      "SELECT 1 FROM site_viewers WHERE site_id = $1 AND lower(viewer_email) = $2",
      [site.id, lower],
    );
    if (allowed.length === 0) {
      return new NextResponse("Forbidden", { status: 403 });
    }
  }

  // 4. Resolve the object key. MVP stores a single index.html; sub-paths are
  //    supported for forward-compatibility with multi-file sites.
  const subPath = (path || []).join("/");
  const key = subPath ? `${site.s3_prefix}${subPath}` : site.index_key;

  const object = await getObject(key);
  if (!object) {
    return new NextResponse("Not found", { status: 404 });
  }

  // First-party analytics: record the page view (never blocks serving).
  await track("site_view", {
    siteId: site.id,
    actor: lower,
    meta: { path: subPath || "index", owner: isOwner },
  });

  // 5. Serve with a sandboxing content-security policy. Self-contained pages
  //    (inline styles/scripts, embedded/data images) render; cross-origin
  //    exfiltration and framing are constrained.
  const headers = new Headers();
  headers.set("Content-Type", object.contentType);
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Content-Type-Options", "nosniff");
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
