import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { serveSite } from "@/lib/siteServing";
import { servePreview, handlePreviewPasswordSubmit } from "@/lib/previewServing";
import { siteSlugForVerifiedHostname } from "@/lib/domains";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requestHost(req: Request): string {
  return (req.headers.get("host") || "").split(":")[0].toLowerCase();
}

function publicPathFrom(path: string[] | undefined): string {
  const joined = (path || []).join("/");
  return joined ? `/${joined}` : "/";
}

/**
 * Resolve which site/preview a non-canonical Host header addresses. Checked
 * in this order: the preview-apex pattern (most specific — a bare UUID
 * label), the site-apex pattern, then a verified custom domain lookup.
 * Both apex env vars are optional; when unset those branches are simply
 * skipped, so this always still supports custom domains even with no
 * synthetic-subdomain apex configured at all.
 */
async function resolveHost(
  host: string,
): Promise<
  | { kind: "site"; slug: string }
  | { kind: "preview"; slug: string; deploymentId: string }
  | { kind: "none" }
> {
  const previewApex = process.env.MICROBUILD_PREVIEW_APEX_DOMAIN;
  if (previewApex && host.endsWith(`.${previewApex}`)) {
    const deploymentId = host.slice(0, -(previewApex.length + 1));
    if (UUID_RE.test(deploymentId)) {
      const rows = await query<{ slug: string }>(
        "SELECT s.slug FROM deployments d JOIN sites s ON s.id = d.site_id WHERE d.id = $1",
        [deploymentId],
      ).catch(() => []);
      if (rows[0]) return { kind: "preview", slug: rows[0].slug, deploymentId };
    }
    return { kind: "none" };
  }

  const apex = process.env.MICROBUILD_APEX_DOMAIN;
  if (apex && host.endsWith(`.${apex}`)) {
    const slug = host.slice(0, -(apex.length + 1));
    return slug ? { kind: "site", slug } : { kind: "none" };
  }

  const slug = await siteSlugForVerifiedHostname(host);
  return slug ? { kind: "site", slug } : { kind: "none" };
}

// app/mbhost/[[...path]]/route.ts — the database-backed half of CD-20's
// host-based routing. middleware.ts rewrites every request whose Host header
// isn't this app's own canonical host to here; this handler figures out
// which site or preview that host actually addresses and delegates to the
// exact same serving logic the path-based /s/[slug]/... routes use (see
// lib/siteServing.ts / lib/previewServing.ts) — byte-identical output,
// just reached by a different URL shape.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ path?: string[] }> },
) {
  const { path } = await params;
  const resolved = await resolveHost(requestHost(req));
  const publicPath = publicPathFrom(path);

  if (resolved.kind === "site") {
    return serveSite(req, resolved.slug, path || []);
  }
  if (resolved.kind === "preview") {
    return servePreview(req, {
      slug: resolved.slug,
      deploymentId: resolved.deploymentId,
      path: path || [],
      publicPath,
    });
  }
  return new NextResponse("Not found", { status: 404 });
}

// POST — only the preview password form submits here.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ path?: string[] }> },
) {
  const { path } = await params;
  const resolved = await resolveHost(requestHost(req));
  const publicPath = publicPathFrom(path);

  if (resolved.kind === "preview") {
    return handlePreviewPasswordSubmit(req, {
      slug: resolved.slug,
      deploymentId: resolved.deploymentId,
      publicPath,
      cookiePath: "/",
    });
  }
  return new NextResponse("Not found", { status: 404 });
}
