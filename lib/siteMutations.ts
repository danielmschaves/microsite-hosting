import { query, type SiteRow, type WorkspaceRow } from "./db";
import { expiresAtFrom, isTtlPreset } from "./ttl";
import { normalizeSlug } from "./slug";
import { isVisibility } from "./authz";
import { planForWorkspace, allowedTtlPresets } from "./plan";
import { track } from "./events";

// Owner-scoped site mutations shared by the session route
// (PATCH /api/sites/[id]) and the token API (PATCH /api/v1/sites/[slug]).
// Each returns { status, body } for the route to serialize; authorization
// happens in the callers (authorizeSiteManage / requireApiAuth + owner check).

export interface MutationResult {
  status: number;
  body: Record<string, unknown>;
}

async function workspaceFor(workspaceId: string | null): Promise<WorkspaceRow | null> {
  if (!workspaceId) return null;
  const rows = await query<WorkspaceRow>("SELECT * FROM workspaces WHERE id = $1", [
    workspaceId,
  ]);
  return rows[0] ?? null;
}

export async function changeVisibility(
  site: SiteRow,
  email: string,
  visibilityRaw: string,
  meta: Record<string, unknown> = {},
): Promise<MutationResult> {
  if (!isVisibility(visibilityRaw)) {
    return {
      status: 400,
      body: { error: "visibility must be only_me, allowlist, team or public" },
    };
  }
  const visibility = visibilityRaw;
  if (visibility === "team" && !site.workspace_id) {
    return {
      status: 400,
      body: { error: "Team visibility requires the site to belong to a workspace" },
    };
  }
  if (visibility === "team") {
    const ws = await workspaceFor(site.workspace_id);
    if (planForWorkspace(ws).id !== "team") {
      return {
        status: 402,
        body: {
          error: "Team visibility requires the Team plan",
          upgradeUrl: `/teams/${site.workspace_id}`,
        },
      };
    }
  }
  await query("UPDATE sites SET visibility = $1 WHERE id = $2", [visibility, site.id]);
  await track("visibility_changed", {
    siteId: site.id,
    workspaceId: site.workspace_id ?? undefined,
    actor: email,
    meta: { from: site.visibility, to: visibility, ...meta },
  });
  return { status: 200, body: { ok: true, visibility } };
}

// The S3 prefix is stored per-site and never derived from the slug, so a
// rename is metadata-only: no object moves, old links simply stop resolving.
export async function renameSlug(
  site: SiteRow,
  email: string,
  slugRaw: string,
  meta: Record<string, unknown> = {},
): Promise<MutationResult> {
  const slug = normalizeSlug(slugRaw);
  if (!slug) {
    return {
      status: 400,
      body: { error: "Invalid slug (use 3-63 lowercase letters, numbers, dashes)" },
    };
  }
  if (slug !== site.slug) {
    const taken = await query(
      "SELECT 1 FROM sites WHERE slug = $1 AND deleted_at IS NULL AND id <> $2",
      [slug, site.id],
    );
    if (taken.length > 0) {
      return { status: 409, body: { error: "Slug already taken" } };
    }
    await query("UPDATE sites SET slug = $1 WHERE id = $2", [slug, site.id]);
    await track("slug_renamed", {
      siteId: site.id,
      workspaceId: site.workspace_id ?? undefined,
      actor: email,
      meta: { from: site.slug, to: slug, ...meta },
    });
  }
  return { status: 200, body: { ok: true, slug } };
}

// Extending resets the countdown from now and re-arms expiry notifications.
export async function extendTtl(
  site: SiteRow,
  email: string,
  ttl: string,
  meta: Record<string, unknown> = {},
): Promise<MutationResult> {
  if (!isTtlPreset(ttl)) {
    return {
      status: 400,
      body: { error: "Provide a ttl preset (24h, 7d, 30d, 90d)" },
    };
  }
  const ws = await workspaceFor(site.workspace_id);
  const plan = planForWorkspace(ws);
  const allowed = allowedTtlPresets(plan, ws?.max_ttl_preset ?? null);
  if (!allowed.includes(ttl)) {
    return {
      status: 402,
      body: {
        error: `ttl must be one of ${allowed.join(", ")} on this plan`,
        ...(plan.id === "free"
          ? { upgradeUrl: site.workspace_id ? `/teams/${site.workspace_id}` : "/teams" }
          : {}),
      },
    };
  }
  const expiresAt = expiresAtFrom(ttl);
  await query(
    `UPDATE sites SET ttl_preset = $1, expires_at = $2,
            notified_48h_at = NULL, notified_2h_at = NULL
      WHERE id = $3`,
    [ttl, expiresAt, site.id],
  );
  await track("ttl_extended", {
    siteId: site.id,
    workspaceId: site.workspace_id ?? undefined,
    actor: email,
    meta: { ttl, ...meta },
  });
  return { status: 200, body: { ok: true, expiresAt: expiresAt.toISOString() } };
}
