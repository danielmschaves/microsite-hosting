import { NextResponse } from "next/server";
import { query, type WorkspaceRow } from "@/lib/db";
import { listPrefix } from "@/lib/storage";
import { expiresAtFrom, isTtlPreset } from "@/lib/ttl";
import { normalizeSlug } from "@/lib/slug";
import { authorizeSiteManage, isVisibility } from "@/lib/authz";
import { planForWorkspace, allowedTtlPresets } from "@/lib/plan";
import { purgeSiteStorage } from "@/lib/createSite";
import { track } from "@/lib/events";

export const runtime = "nodejs";

async function workspaceFor(workspaceId: string | null): Promise<WorkspaceRow | null> {
  if (!workspaceId) return null;
  const rows = await query<WorkspaceRow>("SELECT * FROM workspaces WHERE id = $1", [
    workspaceId,
  ]);
  return rows[0] ?? null;
}

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
        "UPDATE sites SET deleted_at = NULL, ttl_preset = '7d', expires_at = $1 WHERE id = $2",
        [expiresAtFrom("7d"), id],
      );
    } else {
      await query("UPDATE sites SET deleted_at = NULL WHERE id = $1", [id]);
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
    const visibility = body.visibility;
    if (!isVisibility(visibility)) {
      return NextResponse.json(
        { error: "visibility must be only_me, allowlist or team" },
        { status: 400 },
      );
    }
    if (visibility === "team" && !site.workspace_id) {
      return NextResponse.json(
        { error: "Team visibility requires the site to belong to a workspace" },
        { status: 400 },
      );
    }
    if (visibility === "team") {
      const ws = await workspaceFor(site.workspace_id);
      if (planForWorkspace(ws).id !== "team") {
        return NextResponse.json(
          {
            error: "Team visibility requires the Team plan",
            upgradeUrl: `/teams/${site.workspace_id}`,
          },
          { status: 402 },
        );
      }
    }
    await query("UPDATE sites SET visibility = $1 WHERE id = $2", [visibility, id]);
    await track("visibility_changed", {
      siteId: id,
      workspaceId: site.workspace_id ?? undefined,
      actor: email,
      meta: { from: site.visibility, to: visibility },
    });
    return NextResponse.json({ ok: true, visibility });
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
        workspaceId: site.workspace_id ?? undefined,
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
      { error: "Provide { ttl }, { slug }, { visibility } or { action }" },
      { status: 400 },
    );
  }
  {
    const ws = await workspaceFor(site.workspace_id);
    const plan = planForWorkspace(ws);
    const allowed = allowedTtlPresets(plan, ws?.max_ttl_preset ?? null);
    if (!allowed.includes(ttl)) {
      return NextResponse.json(
        {
          error: `ttl must be one of ${allowed.join(", ")} on this plan`,
          ...(plan.id === "free" ? { upgradeUrl: site.workspace_id ? `/teams/${site.workspace_id}` : "/teams" } : {}),
        },
        { status: 402 },
      );
    }
  }
  const expiresAt = expiresAtFrom(ttl);
  await query("UPDATE sites SET ttl_preset = $1, expires_at = $2 WHERE id = $3", [
    ttl,
    expiresAt,
    id,
  ]);
  await track("ttl_extended", {
    siteId: id,
    workspaceId: site.workspace_id ?? undefined,
    actor: email,
    meta: { ttl },
  });
  return NextResponse.json({ ok: true, expiresAt: expiresAt.toISOString() });
}
