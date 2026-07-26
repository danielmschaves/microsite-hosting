import { NextResponse } from "next/server";
import { query, type SiteRow } from "@/lib/db";
import { requireApiAuth } from "@/lib/apiTokens";
import { purgeSiteStorage } from "@/lib/createSite";
import { changeVisibility, renameSlug, extendTtl } from "@/lib/siteMutations";
import { track } from "@/lib/events";

export const runtime = "nodejs";

const VIA = { via: "api" } as const;

async function ownedSite(
  slug: string,
  email: string,
): Promise<SiteRow | null> {
  const rows = await query<SiteRow>(
    "SELECT * FROM sites WHERE slug = $1 AND deleted_at IS NULL AND purged_at IS NULL",
    [slug],
  );
  const site = rows[0];
  if (!site || site.owner_email.toLowerCase() !== email.toLowerCase()) return null;
  return site;
}

// PATCH /api/v1/sites/{slug} — JSON { ttl } | { visibility } | { slug }.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const authRes = await requireApiAuth(req);
  if ("error" in authRes) return authRes.error;
  const { slug } = await params;

  const site = await ownedSite(slug, authRes.email);
  if (!site) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  let result;
  if (typeof body?.visibility === "string") {
    result = await changeVisibility(site, authRes.email, body.visibility, VIA);
  } else if (typeof body?.slug === "string") {
    result = await renameSlug(site, authRes.email, body.slug, VIA);
  } else if (typeof body?.ttl === "string") {
    result = await extendTtl(site, authRes.email, body.ttl, VIA);
  } else {
    return NextResponse.json(
      { error: "Provide { ttl }, { visibility } or { slug }" },
      { status: 400 },
    );
  }
  return NextResponse.json(result.body, { status: result.status });
}

// DELETE /api/v1/sites/{slug} — move to trash; ?permanent=true purges storage.
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const authRes = await requireApiAuth(req);
  if ("error" in authRes) return authRes.error;
  const { slug } = await params;

  const site = await ownedSite(slug, authRes.email);
  if (!site) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const permanent = new URL(req.url).searchParams.get("permanent") === "true";
  if (permanent) {
    await purgeSiteStorage(site);
    await query(
      "UPDATE sites SET deleted_at = COALESCE(deleted_at, now()), purged_at = now() WHERE id = $1",
      [site.id],
    );
    await track("site_purged", {
      siteId: site.id,
      workspaceId: site.workspace_id ?? undefined,
      actor: authRes.email,
      meta: { by: "owner", ...VIA },
    });
    return NextResponse.json({ ok: true, purged: true });
  }

  await query("UPDATE sites SET deleted_at = now() WHERE id = $1", [site.id]);
  await track("site_trashed", {
    siteId: site.id,
    workspaceId: site.workspace_id ?? undefined,
    actor: authRes.email,
    meta: { by: "owner", ...VIA },
  });
  return NextResponse.json({ ok: true, trashed: true });
}
