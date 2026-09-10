import { query, withTransaction, type SiteRow, type SiteVersionRow, type WorkspaceRow } from "./db";
import { expiresAtFrom, isTtlPreset } from "./ttl";
import { normalizeSlug } from "./slug";
import { isVisibility } from "./authz";
import { planForWorkspace, allowedTtlPresets } from "./plan";
import { track } from "./events";
import { createDeployment, transitionDeployment } from "./deployments";

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

/**
 * Instant rollback: flip the sites row to an older version's prefix/index.
 * No bytes move — pruning never deletes the live prefix, so the target
 * version's files are still in storage. Shared by the human rollback route
 * and the agent `rollback_to_version` tool.
 *
 * Wrapped in withTransaction + SELECT...FOR UPDATE (unlike the bare UPDATE
 * this replaced) so a rollback racing a concurrent publish/rollback can't
 * interleave — agents can call this far more often than a human clicking a
 * button, so the existing race is worth closing here while touching the code
 * anyway (see CLAUDE.md's Agent Gateway risk notes).
 */
export async function rollbackToVersion(
  site: SiteRow,
  email: string,
  version: number,
  meta: Record<string, unknown> = {},
): Promise<MutationResult> {
  if (!Number.isInteger(version) || version < 1) {
    return { status: 400, body: { error: "Provide a valid version number" } };
  }
  if (version === site.current_version) {
    return { status: 400, body: { error: "Already the current version" } };
  }

  const result = await withTransaction(async (tx) => {
    await tx("SELECT id FROM sites WHERE id = $1 FOR UPDATE", [site.id]);
    const rows = await tx<SiteVersionRow>(
      "SELECT * FROM site_versions WHERE site_id = $1 AND version = $2",
      [site.id, version],
    );
    const target = rows[0];
    if (!target) return null;

    const updated = await tx<SiteRow>(
      `UPDATE sites
          SET s3_prefix = $1, index_key = $2, size_bytes = $3, page_count = $4,
              current_version = $5
        WHERE id = $6
        RETURNING *`,
      [
        target.s3_prefix,
        target.index_key,
        target.size_bytes,
        target.page_count,
        target.version,
        site.id,
      ],
    );
    return updated[0];
  });

  if (!result) {
    return { status: 404, body: { error: "Version not found (older versions are pruned)" } };
  }

  await track("site_rolled_back", {
    siteId: site.id,
    workspaceId: site.workspace_id ?? undefined,
    actor: email,
    meta: { from: site.current_version, to: version, ...meta },
  });

  // Audit-trail symmetry with the deployments model: record the rollback as
  // its own versions/deployments entry. Best-effort — this never blocks the
  // pointer flip above, which is already committed.
  try {
    const versionRow = await query<{ id: string }>(
      "SELECT id FROM versions WHERE site_id = $1 AND number = $2",
      [site.id, version],
    );
    if (versionRow[0]) {
      const deployment = await createDeployment({
        siteId: site.id,
        versionId: versionRow[0].id,
        target: "production",
        createdBy: email,
        actorType: (meta.actorType as "human" | "agent") ?? "human",
      });
      const building = await transitionDeployment(deployment.id, "building");
      const ready = await transitionDeployment(building.id, "ready");
      const published = await transitionDeployment(ready.id, "published");
      await query("UPDATE sites SET production_deployment_id = $1 WHERE id = $2", [
        published.id,
        site.id,
      ]);
    }
  } catch (err) {
    console.error("[rollback] deployment bookkeeping failed", err);
  }

  return { status: 200, body: { ok: true, version } };
}
