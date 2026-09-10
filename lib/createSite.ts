import { NextResponse } from "next/server";
import {
  query,
  withTransaction,
  type SiteRow,
  type WorkspaceRow,
  type VersionSource,
  type DeploymentRow,
} from "./db";
import { deletePrefix } from "./storage";
import { releaseCasRefs } from "./cas";
import { generateSlug, normalizeSlug } from "./slug";
import { expiresAtFrom, isTtlPreset, type TtlPreset } from "./ttl";
import { getMembership } from "./teams";
import { isVisibility, type Visibility } from "./authz";
import { planForWorkspace, allowedTtlPresets, fakeTeam, type PlanLimits } from "./plan";
import { track } from "./events";
import { recordProductionDeployment } from "./deployments";

// Shared machinery for both upload paths (multipart fallback and presigned
// browser->S3). Validation runs before any bytes move; createSiteRecord runs
// after the files are in storage.

export const MAX_PAGES = 20;
const EMAIL_LIST_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Path-safe stored filename, or null if unusable. */
export function sanitizeFilename(name: string): string | null {
  const base = name.split(/[\\/]/).pop() || "";
  const cleaned = base
    .trim()
    .replace(/[^a-zA-Z0-9._ -]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+/, "");
  if (!/\.html?$/i.test(cleaned)) return null;
  if (cleaned.length < 6 || cleaned.length > 128) return null; // "a.html" = 6
  return cleaned;
}

export function parseEmails(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(/[\s,;]+/)
        .map((e) => e.trim().toLowerCase())
        .filter((e) => EMAIL_LIST_RE.test(e)),
    ),
  );
}

export interface ValidatedUpload {
  workspace: WorkspaceRow | null;
  workspaceId: string | null;
  visibility: Visibility;
  plan: PlanLimits;
  ttl: TtlPreset;
}

/**
 * Destination, visibility, plan, TTL and site-count gates (PRD §7). Returns
 * an error response or the resolved context. Size checks happen separately —
 * declared sizes at presign time, S3-reported truth at completion.
 */
export async function validateUploadRequest(opts: {
  email: string;
  ttl: string;
  workspaceId: string | null;
  visibilityRaw: string;
  /**
   * Re-upload to an existing owned slug (new version). Destination and
   * visibility are pinned to the site's current settings — the request's
   * workspace/visibility params are ignored — and the site-count gate is
   * skipped (it is not a new site).
   */
  updating?: SiteRow;
}): Promise<{ error: NextResponse } | ValidatedUpload> {
  const { email, ttl } = opts;

  if (opts.updating) {
    const site = opts.updating;
    const workspace = site.workspace_id
      ? ((
          await query<WorkspaceRow>("SELECT * FROM workspaces WHERE id = $1", [
            site.workspace_id,
          ])
        )[0] ?? null)
      : null;
    const plan = planForWorkspace(workspace);
    const allowedTtls = allowedTtlPresets(plan, workspace?.max_ttl_preset ?? null);
    if (!isTtlPreset(ttl) || !allowedTtls.includes(ttl)) {
      return {
        error: NextResponse.json(
          { error: `ttl must be one of ${allowedTtls.join(", ")} on this plan` },
          { status: isTtlPreset(ttl) ? 402 : 400 },
        ),
      };
    }
    return {
      workspace,
      workspaceId: site.workspace_id,
      visibility: site.visibility as Visibility,
      plan,
      ttl,
    };
  }

  const workspaceId = opts.workspaceId;
  if (!isVisibility(opts.visibilityRaw)) {
    return {
      error: NextResponse.json(
        { error: "visibility must be only_me, allowlist or team" },
        { status: 400 },
      ),
    };
  }
  const visibility = opts.visibilityRaw;

  let workspace: WorkspaceRow | null = null;
  if (workspaceId) {
    const membership = await getMembership(email, workspaceId).catch(() => null);
    if (!membership) {
      return {
        error: NextResponse.json(
          { error: "You are not a member of that workspace" },
          { status: 403 },
        ),
      };
    }
    workspace =
      (
        await query<WorkspaceRow>("SELECT * FROM workspaces WHERE id = $1", [
          workspaceId,
        ])
      )[0] ?? null;
  }
  if (visibility === "team" && !workspaceId) {
    return {
      error: NextResponse.json(
        { error: "Team visibility requires a workspace destination" },
        { status: 400 },
      ),
    };
  }

  const plan = planForWorkspace(workspace);
  if (visibility === "team" && plan.id !== "team") {
    return {
      error: NextResponse.json(
        { error: "Team visibility requires the Team plan", upgradeUrl: `/teams/${workspaceId}` },
        { status: 402 },
      ),
    };
  }

  const allowedTtls = allowedTtlPresets(plan, workspace?.max_ttl_preset ?? null);
  if (!isTtlPreset(ttl) || !allowedTtls.includes(ttl)) {
    return {
      error: NextResponse.json(
        {
          error: `ttl must be one of ${allowedTtls.join(", ")} on this plan`,
          ...(plan.id === "free"
            ? { upgradeUrl: workspaceId ? `/teams/${workspaceId}` : "/teams" }
            : {}),
        },
        { status: isTtlPreset(ttl) ? 402 : 400 },
      ),
    };
  }

  // Site-count gate: team workspaces count their own sites; free contexts
  // count the owner's live sites outside team-plan workspaces.
  if (plan.id === "team" && workspaceId) {
    const wsCount = await query<{ count: string }>(
      "SELECT count(*) FROM sites WHERE workspace_id = $1 AND deleted_at IS NULL",
      [workspaceId],
    );
    if (Number(wsCount[0].count) >= plan.siteLimit) {
      return {
        error: NextResponse.json(
          { error: `Workspace limit of ${plan.siteLimit} active sites reached` },
          { status: 402 },
        ),
      };
    }
  } else {
    const freeCount = await query<{ count: string }>(
      `SELECT count(*) FROM sites s
        LEFT JOIN workspaces w ON w.id = s.workspace_id
        WHERE s.owner_email = $1 AND s.deleted_at IS NULL
          AND (s.workspace_id IS NULL OR ${fakeTeam ? "false" : "w.plan <> 'team'"})`,
      [email],
    );
    if (Number(freeCount[0].count) >= plan.siteLimit) {
      return {
        error: NextResponse.json(
          {
            error: `Free plan limit of ${plan.siteLimit} active sites reached — delete one or upgrade a workspace`,
            upgradeUrl: "/teams",
          },
          { status: 402 },
        ),
      };
    }
  }

  return { workspace, workspaceId, visibility, plan, ttl };
}

/** Resolve which uploaded file is the index page. */
export function resolveIndex(
  names: string[],
  requestedIndex: string,
): { indexName: string } | { error: string } {
  if (requestedIndex) {
    const match = sanitizeFilename(requestedIndex);
    if (!match || !names.includes(match)) {
      return { error: "index must name one of the uploaded files" };
    }
    return { indexName: match };
  }
  if (names.length === 1) return { indexName: names[0] };
  const auto = names.find((n) => n.toLowerCase() === "index.html");
  if (!auto) {
    return { error: "Multiple files: include an index.html or mark one as index" };
  }
  return { indexName: auto };
}

/**
 * Validate a requested slug or generate a unique one. When the requested
 * slug belongs to a live site owned by `email`, the result carries that
 * site: the upload becomes a re-publish (new version, same URL). A live
 * slug owned by anyone else stays a hard 409 — never let a re-upload
 * take over someone else's slug.
 */
export async function resolveSlug(
  requestedSlug: string,
  email?: string,
): Promise<
  { slug: string; existing?: SiteRow } | { error: string; status: number }
> {
  if (requestedSlug) {
    const slug = normalizeSlug(requestedSlug);
    if (!slug) {
      return {
        error: "Invalid slug (use 3-63 lowercase letters, numbers, dashes)",
        status: 400,
      };
    }
    const existing = await query<SiteRow>(
      "SELECT * FROM sites WHERE slug = $1 AND deleted_at IS NULL",
      [slug],
    );
    if (existing.length > 0) {
      const site = existing[0];
      if (email && site.owner_email.toLowerCase() === email.toLowerCase()) {
        return { slug, existing: site };
      }
      return { error: "Slug already taken", status: 409 };
    }
    return { slug };
  }
  for (let i = 0; i < 8; i++) {
    const candidate = generateSlug();
    const existing = await query(
      "SELECT 1 FROM sites WHERE slug = $1 AND deleted_at IS NULL",
      [candidate],
    );
    if (existing.length === 0) return { slug: candidate };
  }
  return { slug: `${generateSlug()}-${Date.now().toString(36)}` };
}

/** Insert the site row + viewers + analytics after files are in storage. */
export async function createSiteRecord(opts: {
  email: string;
  slug: string;
  s3Prefix: string;
  indexName: string;
  totalBytes: number;
  pageCount: number;
  ttl: TtlPreset;
  workspaceId: string | null;
  visibility: Visibility;
  viewers: string[];
  actorType?: "human" | "agent";
  agentClientId?: string | null;
  source?: VersionSource;
}): Promise<SiteRow> {
  const expiresAt = expiresAtFrom(opts.ttl);
  const inserted = await query<SiteRow>(
    `INSERT INTO sites
       (slug, owner_email, s3_prefix, index_key, content_type, size_bytes, page_count, ttl_preset, expires_at, workspace_id, visibility)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      opts.slug,
      opts.email,
      opts.s3Prefix,
      `${opts.s3Prefix}${opts.indexName}`,
      "text/html",
      opts.totalBytes,
      opts.pageCount,
      opts.ttl,
      expiresAt,
      opts.workspaceId,
      opts.visibility,
    ],
  );
  const site = inserted[0];

  // Version history starts at 1 so every site has a uniform trail.
  await query(
    `INSERT INTO site_versions (site_id, version, s3_prefix, index_key, size_bytes, page_count, created_by)
     VALUES ($1, 1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
    [
      site.id,
      opts.s3Prefix,
      `${opts.s3Prefix}${opts.indexName}`,
      opts.totalBytes,
      opts.pageCount,
      opts.email,
    ],
  );

  // Agent Gateway (PRD v2.0 CD-14): mirror the same version into the
  // versions/deployments bookkeeping so `sites.production_deployment_id` is
  // set for every new site, not just agent-created ones. Best-effort, own
  // try/catch — this is the free-tier signup path and must never fail site
  // creation because deployment bookkeeping hiccuped.
  try {
    const versionRows = await query<{ id: string }>(
      `INSERT INTO versions (site_id, number, storage_key, source, author_email, actor_type)
       VALUES ($1, 1, $2, $3, $4, $5)
       ON CONFLICT (site_id, number) DO NOTHING
       RETURNING id`,
      [
        site.id,
        opts.s3Prefix,
        opts.source ?? "upload",
        opts.email,
        opts.actorType ?? "human",
      ],
    );
    if (versionRows[0]) {
      await recordProductionDeployment({
        siteId: site.id,
        versionId: versionRows[0].id,
        email: opts.email,
        actorType: opts.actorType ?? "human",
        agentClientId: opts.agentClientId,
      });
    }
  } catch (err) {
    console.error(`[createSite] deployment bookkeeping failed for new site ${site.id}`, err);
  }

  const viewers = opts.visibility === "allowlist" ? opts.viewers : [];
  for (const viewer of viewers) {
    await query(
      `INSERT INTO site_viewers (site_id, viewer_email)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [site.id, viewer],
    );
  }

  await track("site_created", {
    siteId: site.id,
    workspaceId: opts.workspaceId ?? undefined,
    actor: opts.email,
    meta: {
      pages: opts.pageCount,
      ttl: opts.ttl,
      bytes: opts.totalBytes,
      viewers: viewers.length,
      visibility: opts.visibility,
    },
  });

  return site;
}

/**
 * Publish a new version of an existing site (re-upload to the same slug).
 * The new files are already in storage under `s3Prefix`. Atomically records
 * the version, flips the sites row to point at it (fresh TTL, notification
 * markers cleared), and prunes history beyond the plan's version limit.
 * Storage for pruned versions is deleted after commit — S3 is not part of
 * the transaction.
 */
export async function publishSiteVersion(opts: {
  site: SiteRow;
  email: string;
  s3Prefix: string;
  indexName: string;
  totalBytes: number;
  pageCount: number;
  ttl: TtlPreset;
  versionLimit: number;
  actorType?: "human" | "agent";
  agentClientId?: string | null;
  source?: VersionSource;
}): Promise<{ site: SiteRow; version: number; deployment: DeploymentRow | null }> {
  const expiresAt = expiresAtFrom(opts.ttl);
  const indexKey = `${opts.s3Prefix}${opts.indexName}`;

  const { updated, version, versionId, prunedPrefixes } = await withTransaction(
    async (tx) => {
      // Serialize concurrent publishes to the same site.
      await tx("SELECT id FROM sites WHERE id = $1 FOR UPDATE", [opts.site.id]);
      const next =
        Number(
          (
            await tx<{ max: string | null }>(
              "SELECT MAX(version) AS max FROM site_versions WHERE site_id = $1",
              [opts.site.id],
            )
          )[0]?.max ?? 0,
        ) + 1;

      await tx(
        `INSERT INTO site_versions (site_id, version, s3_prefix, index_key, size_bytes, page_count, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          opts.site.id,
          next,
          opts.s3Prefix,
          indexKey,
          opts.totalBytes,
          opts.pageCount,
          opts.email,
        ],
      );

      // Agent Gateway (PRD v2.0 CD-14): record the matching versions row
      // under the SAME row lock as the site_versions insert above — closes
      // a race the old post-commit bookkeeping (removed) had, where two
      // concurrent publishes could interleave after the lock was released.
      const versionRows = await tx<{ id: string }>(
        `INSERT INTO versions (site_id, number, storage_key, source, author_email, actor_type)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (site_id, number) DO NOTHING
         RETURNING id`,
        [
          opts.site.id,
          next,
          opts.s3Prefix,
          opts.source ?? "upload",
          opts.email,
          opts.actorType ?? "human",
        ],
      );
      const versionId = versionRows[0]?.id ?? null;

      const updated = (
        await tx<SiteRow>(
          `UPDATE sites
              SET s3_prefix = $1, index_key = $2, size_bytes = $3, page_count = $4,
                  current_version = $5, ttl_preset = $6, expires_at = $7,
                  notified_48h_at = NULL, notified_2h_at = NULL
            WHERE id = $8
            RETURNING *`,
          [
            opts.s3Prefix,
            indexKey,
            opts.totalBytes,
            opts.pageCount,
            next,
            opts.ttl,
            expiresAt,
            opts.site.id,
          ],
        )
      )[0];

      // Prune beyond the retention window. Never drop a row whose prefix is
      // the live one (possible after a rollback) — that would delete the
      // bytes currently being served.
      const pruned = await tx<{ s3_prefix: string }>(
        `DELETE FROM site_versions
          WHERE site_id = $1 AND version <= $2 AND s3_prefix <> $3
          RETURNING s3_prefix`,
        [opts.site.id, next - opts.versionLimit, updated.s3_prefix],
      );

      return {
        updated,
        version: next,
        versionId,
        prunedPrefixes: pruned.map((p) => p.s3_prefix),
      };
    },
  );

  for (const prefix of prunedPrefixes) {
    try {
      await deletePrefix(prefix);
    } catch (err) {
      console.error(`[versions] prune failed for ${prefix}`, err);
    }
  }

  await track("site_version_published", {
    siteId: opts.site.id,
    workspaceId: opts.site.workspace_id ?? undefined,
    actor: opts.email,
    meta: {
      version,
      pages: opts.pageCount,
      bytes: opts.totalBytes,
      ttl: opts.ttl,
      pruned: prunedPrefixes.length,
    },
  });

  // Agent Gateway (PRD v2.0 CD-14): best-effort, outside the transaction —
  // same "record after commit" placement as the prune loop above. Every
  // caller of publishSiteVersion (dashboard upload, presigned completion,
  // v1 API, agent publish) gets this for free now, closing the gap where
  // only the agent path used to update production_deployment_id.
  const deployment = versionId
    ? await recordProductionDeployment({
        siteId: opts.site.id,
        versionId,
        email: opts.email,
        actorType: opts.actorType ?? "human",
        agentClientId: opts.agentClientId,
      })
    : null;

  return { site: updated, version, deployment };
}

/**
 * Delete ALL storage belonging to a site — the live prefix plus every
 * retained version prefix (site_versions AND the Agent Gateway's versions
 * table, including preview snapshots and, once CD-04 is wired into a
 * publish path, content-addressed versions) — and drop the version rows.
 * The single purge path used by cron phase 2, ?permanent=true deletes, and
 * restores-gone-wrong; keeping it centralized prevents orphaned prefixes.
 */
export async function purgeSiteStorage(site: {
  id: string;
  s3_prefix: string;
}): Promise<void> {
  const oldVersions = await query<{ s3_prefix: string }>(
    "SELECT DISTINCT s3_prefix FROM site_versions WHERE site_id = $1",
    [site.id],
  );
  const versions = await query<{ id: string; storage_key: string; content_digest: string | null }>(
    "SELECT id, storage_key, content_digest FROM versions WHERE site_id = $1",
    [site.id],
  );

  const prefixesToDelete = new Set<string>([
    site.s3_prefix,
    ...oldVersions.map((v) => v.s3_prefix),
  ]);
  for (const v of versions) {
    if (v.content_digest) {
      await releaseCasRefs(v.id);
    } else {
      prefixesToDelete.add(v.storage_key);
    }
  }

  for (const prefix of prefixesToDelete) {
    await deletePrefix(prefix);
  }

  await query("DELETE FROM site_versions WHERE site_id = $1", [site.id]);
  await query("DELETE FROM versions WHERE site_id = $1", [site.id]);
}
