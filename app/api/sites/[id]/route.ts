import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { listPrefix } from "@/lib/storage";
import { expiresAtFrom } from "@/lib/ttl";
import { authorizeSiteManage } from "@/lib/authz";
import { purgeSiteStorage } from "@/lib/createSite";
import { changeVisibility, renameSlug, extendTtl } from "@/lib/siteMutations";
import { track } from "@/lib/events";

export const runtime = "nodejs";

// DELETE — move to trash (default) or purge permanently (?permanent=true).
// Owner always; workspace admins may trash/purge team-workspace sites.
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const res = await authorizeSiteManage(id, { allowWorkspaceAdmin: true });
  if ("error" in res) return res.error;
  const { site, email } = res;

  const permanent = new URL(req.url).searchParams.get("permanent") === "true";

  if (permanent) {
    await purgeSiteStorage(site);
    await query(
      "UPDATE sites SET deleted_at = COALESCE(deleted_at, now()), purged_at = now() WHERE id = $1",
      [id],
    );
    await track("site_purged", {
      siteId: id,
      workspaceId: site.workspace_id ?? undefined,
      actor: email,
      meta: { by: res.role },
    });
    return NextResponse.json({ ok: true, purged: true });
  }

  if (site.deleted_at) {
    return NextResponse.json({ ok: true, trashed: true }); // already in trash
  }
  await query("UPDATE sites SET deleted_at = now() WHERE id = $1", [id]);
  await track("site_trashed", {
    siteId: id,
    workspaceId: site.workspace_id ?? undefined,
    actor: email,
    meta: { by: res.role },
  });
  return NextResponse.json({ ok: true, trashed: true });
}

// PATCH — { ttl } | { slug } | { visibility } | { action: "restore" | "force_expire" }.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  // Force-expire is the one owner-or-admin mutation besides trash: serving
  // stops instantly (expires_at = now); the cron trashes it on its next run.
  if (body?.action === "force_expire") {
    const res = await authorizeSiteManage(id, { allowWorkspaceAdmin: true });
    if ("error" in res) return res.error;
    await query("UPDATE sites SET expires_at = now() WHERE id = $1", [id]);
    await track("site_force_expired", {
      siteId: id,
      workspaceId: res.site.workspace_id ?? undefined,
      actor: res.email,
      meta: { by: res.role },
    });
    return NextResponse.json({ ok: true, forceExpired: true });
  }

  // Everything below is owner-only.
  const res = await authorizeSiteManage(id);
  if ("error" in res) return res.error;
  const { site, email } = res;

  // --- restore from trash --------------------------------------------------
  if (body?.action === "restore") {
    if (!site.deleted_at) {
      return NextResponse.json({ error: "Site is not in trash" }, { status: 400 });
    }
    const clash = await query(
      "SELECT 1 FROM sites WHERE slug = $1 AND deleted_at IS NULL AND id <> $2",
      [site.slug, id],
    );
    if (clash.length > 0) {
      return NextResponse.json(
        { error: "Slug is now used by another site — cannot restore" },
        { status: 409 },
      );
    }
    const expired = new Date(site.expires_at).getTime() <= Date.now();
    if (expired) {
      await query(
        `UPDATE sites SET deleted_at = NULL, ttl_preset = '7d', expires_at = $1,
                notified_48h_at = NULL, notified_2h_at = NULL
          WHERE id = $2`,
        [expiresAtFrom("7d"), id],
      );
    } else {
      await query(
        "UPDATE sites SET deleted_at = NULL, notified_48h_at = NULL, notified_2h_at = NULL WHERE id = $1",
        [id],
      );
    }
    await track("site_restored", {
      siteId: id,
      workspaceId: site.workspace_id ?? undefined,
      actor: email,
    });
    return NextResponse.json({ ok: true, restored: true });
  }

  // --- visibility ----------------------------------------------------------
  if (typeof body?.visibility === "string") {
    const result = await changeVisibility(site, email, body.visibility);
    return NextResponse.json(result.body, { status: result.status });
  }

  // --- set index page --------------------------------------------------------
  if (typeof body?.index === "string") {
    const name = body.index;
    const stored = await listPrefix(site.s3_prefix).catch(() => []);
    if (!stored.some((f) => f.name === name)) {
      return NextResponse.json(
        { error: "index must name one of the site's pages" },
        { status: 400 },
      );
    }
    await query("UPDATE sites SET index_key = $1 WHERE id = $2", [
      `${site.s3_prefix}${name}`,
      id,
    ]);
    await track("index_changed", {
      siteId: id,
      workspaceId: site.workspace_id ?? undefined,
      actor: email,
      meta: { to: name },
    });
    return NextResponse.json({ ok: true, index: name });
  }

  // --- rename slug ---------------------------------------------------------
  if (typeof body?.slug === "string") {
    const result = await renameSlug(site, email, body.slug);
    return NextResponse.json(result.body, { status: result.status });
  }

  // --- extend TTL ----------------------------------------------------------
  if (typeof body?.ttl !== "string" || !body.ttl) {
    return NextResponse.json(
      { error: "Provide { ttl }, { slug }, { visibility }, { index } or { action }" },
      { status: 400 },
    );
  }
  const result = await extendTtl(site, email, body.ttl);
  return NextResponse.json(result.body, { status: result.status });
}
