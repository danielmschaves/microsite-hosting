import {
  query,
  withTransaction,
  type DeploymentRow,
  type DeploymentStatus,
  type DeploymentTarget,
  type SiteRow,
} from "./db";
import { publishSiteVersion } from "./createSite";
import { track, type EventType } from "./events";
import type { TtlPreset } from "./ttl";
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
 * Publish a production deployment: wraps the existing publishSiteVersion
 * (which remains the only code that moves the sites pointer in R0/R1),
 * records the matching versions/deployments rows, and updates
 * sites.production_deployment_id. A failure between the two steps leaves
 * site_versions briefly ahead of versions/deployments — acceptable because
 * nothing reads the new tables for serving yet, and the next
 * verifyAddressingParity() run heals any drift (see lib/backfillDeployments.ts).
 */
export async function publishDeployment(opts: {
  site: SiteRow;
  email: string;
  s3Prefix: string;
  indexName: string;
  totalBytes: number;
  pageCount: number;
  ttl: TtlPreset;
  versionLimit: number;
  actorType: "human" | "agent";
  agentClientId?: string | null;
  source?: "upload" | "agent" | "github" | "template" | "rollback";
}): Promise<{ site: SiteRow; version: number; deployment: DeploymentRow }> {
  const published = await publishSiteVersion({
    site: opts.site,
    email: opts.email,
    s3Prefix: opts.s3Prefix,
    indexName: opts.indexName,
    totalBytes: opts.totalBytes,
    pageCount: opts.pageCount,
    ttl: opts.ttl,
    versionLimit: opts.versionLimit,
  });

  const versionRows = await query<{ id: string }>(
    "SELECT id FROM versions WHERE site_id = $1 AND number = $2",
    [published.site.id, published.version],
  );
  let versionId = versionRows[0]?.id;
  if (!versionId) {
    const inserted = await query<{ id: string }>(
      `INSERT INTO versions (site_id, number, storage_key, source, author_email, actor_type)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (site_id, number) DO UPDATE SET storage_key = EXCLUDED.storage_key
       RETURNING id`,
      [
        published.site.id,
        published.version,
        opts.s3Prefix,
        opts.source ?? "upload",
        opts.email,
        opts.actorType,
      ],
    );
    versionId = inserted[0].id;
  }

  const deployment = await createDeployment({
    siteId: published.site.id,
    versionId,
    target: "production",
    createdBy: opts.email,
    actorType: opts.actorType,
    agentClientId: opts.agentClientId,
  });
  const built = await transitionDeployment(deployment.id, "building");
  const ready = await transitionDeployment(built.id, "ready");
  const publishedDeployment = await transitionDeployment(ready.id, "published");

  await query("UPDATE sites SET production_deployment_id = $1 WHERE id = $2", [
    publishedDeployment.id,
    published.site.id,
  ]);

  return { site: published.site, version: published.version, deployment: publishedDeployment };
}
