import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { query, type SiteRow } from "@/lib/db";
import { deletePrefix } from "@/lib/storage";
import { expiresAtFrom, isTtlPreset } from "@/lib/ttl";
import { normalizeSlug } from "@/lib/slug";
import { track } from "@/lib/events";

export const runtime = "nodejs";

/** Load the site and verify the session user owns it. */
async function authorize(id: string) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const rows = await query<SiteRow>("SELECT * FROM sites WHERE id = $1", [id]);
  const site = rows[0];
  if (!site || site.purged_at) {
    return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }
  if (site.owner_email.toLowerCase() !== email.toLowerCase()) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { site, email };
}

// DELETE — move to trash (default) or purge permanently (?permanent=true).
// Trash keeps storage so the site is restorable for the trash window.
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const res = await authorize(id);
  if ("error" in res) return res.error;
  const { site, email } = res;

  const permanent =
    new URL(req.url).searchParams.get("permanent") === "true";

  if (permanent) {
    await deletePrefix(site.s3_prefix);
    await query(
      "UPDATE sites SET deleted_at = COALESCE(deleted_at, now()), purged_at = now() WHERE id = $1",
      [id],
    );
    await track("site_purged", { siteId: id, actor: email, meta: { by: "owner" } });
    return NextResponse.json({ ok: true, purged: true });
  }

  if (site.deleted_at) {
    return NextResponse.json({ ok: true, trashed: true }); // already in trash
  }
  await query("UPDATE sites SET deleted_at = now() WHERE id = $1", [id]);
  await track("site_trashed", { siteId: id, actor: email, meta: { by: "owner" } });
  return NextResponse.json({ ok: true, trashed: true });
}

// PATCH — owner edits: { ttl }, { slug }, or { action: "restore" }.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const res = await authorize(id);
  if ("error" in res) return res.error;
  const { site, email } = res;

  const body = await req.json().catch(() => ({}));

  // --- restore from trash --------------------------------------------------
  if (body?.action === "restore") {
    if (!site.deleted_at) {
      return NextResponse.json({ error: "Site is not in trash" }, { status: 400 });
    }
    // The slug may have been reused by a live site while this one was trashed.
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
    // If the TTL lapsed while trashed, give the restored site a fresh 7 days.
    const expired = new Date(site.expires_at).getTime() <= Date.now();
    if (expired) {
      await query(
        "UPDATE sites SET deleted_at = NULL, ttl_preset = '7d', expires_at = $1 WHERE id = $2",
        [expiresAtFrom("7d"), id],
      );
    } else {
      await query("UPDATE sites SET deleted_at = NULL WHERE id = $1", [id]);
    }
    await track("site_restored", { siteId: id, actor: email });
    return NextResponse.json({ ok: true, restored: true });
  }

  // --- rename slug ---------------------------------------------------------
  // The S3 prefix is stored per-site and never derived from the slug, so a
  // rename is metadata-only: no object moves, old links simply stop resolving.
  if (typeof body?.slug === "string") {
    const slug = normalizeSlug(body.slug);
    if (!slug) {
      return NextResponse.json(
        { error: "Invalid slug (use 3-63 lowercase letters, numbers, dashes)" },
        { status: 400 },
      );
    }
    if (slug !== site.slug) {
      const taken = await query(
        "SELECT 1 FROM sites WHERE slug = $1 AND deleted_at IS NULL AND id <> $2",
        [slug, id],
      );
      if (taken.length > 0) {
        return NextResponse.json({ error: "Slug already taken" }, { status: 409 });
      }
      await query("UPDATE sites SET slug = $1 WHERE id = $2", [slug, id]);
      await track("slug_renamed", {
        siteId: id,
        actor: email,
        meta: { from: site.slug, to: slug },
      });
    }
    return NextResponse.json({ ok: true, slug });
  }

  // --- extend TTL ----------------------------------------------------------
  const ttl = String(body?.ttl || "");
  if (!isTtlPreset(ttl)) {
    return NextResponse.json(
      { error: "Provide { ttl }, { slug } or { action: 'restore' }" },
      { status: 400 },
    );
  }
  const expiresAt = expiresAtFrom(ttl);
  await query("UPDATE sites SET ttl_preset = $1, expires_at = $2 WHERE id = $3", [
    ttl,
    expiresAt,
    id,
  ]);
  await track("ttl_extended", { siteId: id, actor: email, meta: { ttl } });
  return NextResponse.json({ ok: true, expiresAt: expiresAt.toISOString() });
}
