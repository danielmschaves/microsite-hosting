import {
  query,
  withTransaction,
  type DeploymentRow,
  type DeploymentStatus,
  type DeploymentTarget,
  type SiteRow,
  type VersionRow,
} from "./db";
import { track, type EventType } from "./events";
import { canTransition, IllegalTransitionError } from "./deploymentStateMachine";

// ---------------------------------------------------------------------------
// Deployment state machine (PRD v2.0 CD-03). `deployments` is new addressable
// bookkeeping layered on top of the existing sites/site_versions pointer —
// it does not replace publishSiteVersion or move the sites pointer itself in
// R0/R1. See CLAUDE.md's "Agent Gateway" section for the integration
// rationale: a later release flips serving to read from here. The pure
// transition table lives in lib/deploymentStateMachine.ts (re-exported here
// for callers that only need this module) so it can be unit-tested without
// pulling in the rest of the app's import graph.
// ---------------------------------------------------------------------------

export { canTransition, IllegalTransitionError };

const EVENT_FOR_STATUS: Record<DeploymentStatus, EventType> = {
  queued: "deployment_queued",
  building: "deployment_building",
  ready: "deployment_ready",
  published: "deployment_published",
  failed: "deployment_failed",
  canceled: "deployment_canceled",
};

export interface CreateDeploymentOpts {
  siteId: string;
  versionId: string;
  target: DeploymentTarget;
  createdBy: string;
  actorType: "human" | "agent";
  agentClientId?: string | null;
  url?: string | null;
}

export async function createDeployment(opts: CreateDeploymentOpts): Promise<DeploymentRow> {
  const rows = await query<DeploymentRow>(
    `INSERT INTO deployments (site_id, version_id, target, status, created_by, actor_type, agent_client_id, url)
     VALUES ($1, $2, $3, 'queued', $4, $5, $6, $7)
     RETURNING *`,
    [
      opts.siteId,
      opts.versionId,
      opts.target,
      opts.createdBy,
      opts.actorType,
      opts.agentClientId ?? null,
      opts.url ?? null,
    ],
  );
  const deployment = rows[0];
  await track("deployment_queued", {
    siteId: opts.siteId,
    actor: opts.createdBy,
    actorType: opts.actorType,
    meta: { deploymentId: deployment.id, target: opts.target },
  });
  return deployment;
}

export interface TransitionOpts {
  error?: Record<string, unknown>;
  url?: string;
}

/**
 * Move a deployment to `to`, rejecting illegal transitions. Serialized with
 * SELECT...FOR UPDATE, mirroring publishSiteVersion's row-locking pattern
 * (lib/createSite.ts) so two concurrent transitions on the same row can't
 * race each other into an inconsistent state.
 */
export async function transitionDeployment(
  deploymentId: string,
  to: DeploymentStatus,
  opts: TransitionOpts = {},
): Promise<DeploymentRow> {
  const updated = await withTransaction(async (tx) => {
    const rows = await tx<DeploymentRow>(
      "SELECT * FROM deployments WHERE id = $1 FOR UPDATE",
      [deploymentId],
    );
    const current = rows[0];
    if (!current) {
      throw new Error(`Deployment ${deploymentId} not found`);
    }
    if (!canTransition(current.status, to)) {
      throw new IllegalTransitionError(current.status, to, deploymentId);
    }

    const setBuildStarted = to === "building";
    const setBuildFinished = to === "ready" || to === "failed";
    const setPublished = to === "published";

    const result = await tx<DeploymentRow>(
      `UPDATE deployments
          SET status = $1,
              build_started_at = CASE WHEN $2 THEN now() ELSE build_started_at END,
              build_finished_at = CASE WHEN $3 THEN now() ELSE build_finished_at END,
              published_at = CASE WHEN $4 THEN now() ELSE published_at END,
              error = COALESCE($5::jsonb, error),
              url = COALESCE($6, url)
        WHERE id = $7
        RETURNING *`,
      [
        to,
        setBuildStarted,
        setBuildFinished,
        setPublished,
        opts.error ? JSON.stringify(opts.error) : null,
        opts.url ?? null,
        deploymentId,
      ],
    );
    return result[0];
  });

  await track(EVENT_FOR_STATUS[to], {
    siteId: updated.site_id,
    actor: updated.created_by,
    actorType: updated.actor_type,
    meta: { deploymentId, target: updated.target },
  });
  return updated;
}

/**
 * Walk a fresh `versions` row through the full deployment lifecycle to
 * `published` and point `sites.production_deployment_id` at it. This is the
 * single bookkeeping implementation every publish path calls (PRD v2.0
 * CD-14) — previously this only ran for agent-initiated publishes
 * (`lib/deployments.ts`'s old `publishDeployment`), leaving every other
 * publish path (dashboard upload, presigned completion, v1 API, brand-new
 * sites) with a permanently NULL or stale `production_deployment_id`. Never
 * throws — a bookkeeping failure must not block a publish that already
 * succeeded at the `sites`/`site_versions` level; CD-14's serving-time read
 * (`resolveProductionServingKey`) is the safety net that makes this
 * best-effort design safe (see its own doc comment).
 */
export async function recordProductionDeployment(opts: {
  siteId: string;
  versionId: string;
  email: string;
  actorType: "human" | "agent";
  agentClientId?: string | null;
}): Promise<DeploymentRow | null> {
  try {
    const deployment = await createDeployment({
      siteId: opts.siteId,
      versionId: opts.versionId,
      target: "production",
      createdBy: opts.email,
      actorType: opts.actorType,
      agentClientId: opts.agentClientId,
    });
    const built = await transitionDeployment(deployment.id, "building");
    const ready = await transitionDeployment(built.id, "ready");
    const published = await transitionDeployment(ready.id, "published");

    await query("UPDATE sites SET production_deployment_id = $1 WHERE id = $2", [
      published.id,
      opts.siteId,
    ]);
    return published;
  } catch (err) {
    console.error(`[deployments] bookkeeping failed for site ${opts.siteId}`, err);
    return null;
  }
}

export interface ProductionServingKey {
  prefix: string;
  indexKey: string;
  usedDeployment: boolean;
}

/**
 * Resolve the object-storage prefix/index for serving a site's live content,
 * preferring the deployment model but self-healing to the legacy
 * `sites.s3_prefix`/`sites.index_key` columns on any inconsistency — missing
 * deployment, missing version, or (the key invariant, identical to
 * `verifyAddressingParity()`'s own check in lib/backfillDeployments.ts)
 * `versions.storage_key !== sites.s3_prefix`. Never throws, never fails the
 * request — only logs, since a systemic bookkeeping bug must degrade to
 * "exactly today's behavior," not to a broken site. This is CD-14's serving
 * flip: content-addressed/CAS-backed versions (not yet wired into any
 * publish path — content_digest is NULL everywhere today) are the only
 * future case where the deployment path and s3_prefix could legitimately
 * diverge; until then this is provably a no-op resolution.
 */
export async function resolveProductionServingKey(site: SiteRow): Promise<ProductionServingKey> {
  const legacy: ProductionServingKey = {
    prefix: site.s3_prefix,
    indexKey: site.index_key,
    usedDeployment: false,
  };
  if (!site.production_deployment_id) return legacy;

  const deploymentRows = await query<DeploymentRow>(
    "SELECT * FROM deployments WHERE id = $1 AND target = 'production' AND status = 'published'",
    [site.production_deployment_id],
  );
  const deployment = deploymentRows[0];
  if (!deployment) {
    console.warn(
      `[deployments] production_deployment_id ${site.production_deployment_id} for site ${site.id} (${site.slug}) is missing or not published — falling back to legacy addressing`,
    );
    return legacy;
  }

  const versionRows = await query<VersionRow>("SELECT * FROM versions WHERE id = $1", [
    deployment.version_id,
  ]);
  const version = versionRows[0];
  if (!version) {
    console.warn(
      `[deployments] deployment ${deployment.id} for site ${site.id} (${site.slug}) has no versions row — falling back to legacy addressing`,
    );
    return legacy;
  }

  if (version.storage_key !== site.s3_prefix) {
    console.warn(
      `[deployments] addressing drift for site ${site.id} (${site.slug}): versions.storage_key="${version.storage_key}" !== sites.s3_prefix="${site.s3_prefix}" — falling back to legacy addressing`,
    );
    return legacy;
  }

  return { prefix: version.storage_key, indexKey: site.index_key, usedDeployment: true };
}
