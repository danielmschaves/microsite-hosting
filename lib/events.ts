import { query } from "./db";

// First-party product analytics. Events are captured server-side at the choke
// points we already own (upload, serving, lifecycle changes) — no client SDK,
// nothing third-party. Owners see aggregates for their own sites only.
export type EventType =
  | "site_created"
  | "site_view"
  | "ttl_extended"
  | "slug_renamed"
  | "viewer_added"
  | "viewer_removed"
  | "site_trashed"
  | "site_restored"
  | "site_purged"
  | "workspace_created"
  | "workspace_renamed"
  | "member_invited"
  | "member_joined"
  | "member_removed"
  | "member_role_changed"
  | "ttl_policy_changed"
  | "visibility_changed"
  | "site_force_expired"
  | "subscription_updated"
  | "site_version_published"
  | "site_rolled_back"
  | "index_changed"
  | "api_token_created"
  | "api_token_revoked"
  | "expiry_notice_sent"
  // Agent Gateway (PRD v2.0 R0/R1)
  | "deployment_queued"
  | "deployment_building"
  | "deployment_ready"
  | "deployment_published"
  | "deployment_failed"
  | "deployment_canceled"
  | "agent_client_authorized"
  | "agent_token_created"
  | "agent_token_revoked"
  | "agent_action";

export async function track(
  type: EventType,
  opts: {
    siteId?: string;
    workspaceId?: string;
    actor?: string;
    /** "agent" for Agent Gateway-driven mutations; defaults to "human". */
    actorType?: "human" | "agent";
    meta?: Record<string, unknown>;
  } = {},
): Promise<void> {
  try {
    await query(
      "INSERT INTO events (type, site_id, workspace_id, actor, meta, actor_type) VALUES ($1, $2, $3, $4, $5, $6)",
      [
        type,
        opts.siteId ?? null,
        opts.workspaceId ?? null,
        opts.actor ?? null,
        JSON.stringify(opts.meta ?? {}),
        opts.actorType ?? "human",
      ],
    );
  } catch (err) {
    // Analytics must never break product flows.
    console.error(`[events] failed to record ${type}`, err);
  }
}

export interface SiteStats {
  views: number;
  uniqueViewers: number;
  lastViewedAt: string | null;
}

/** Aggregate view stats for a set of sites, keyed by site id. */
export async function statsForSites(
  siteIds: string[],
): Promise<Map<string, SiteStats>> {
  const map = new Map<string, SiteStats>();
  if (siteIds.length === 0) return map;
  const rows = await query<{
    site_id: string;
    views: string;
    unique_viewers: string;
    last_viewed_at: Date | null;
  }>(
    `SELECT site_id,
            count(*)                AS views,
            count(DISTINCT actor)   AS unique_viewers,
            max(created_at)         AS last_viewed_at
       FROM events
      WHERE type = 'site_view' AND site_id = ANY($1::uuid[])
      GROUP BY site_id`,
    [siteIds],
  );
  for (const r of rows) {
    map.set(r.site_id, {
      views: Number(r.views),
      uniqueViewers: Number(r.unique_viewers),
      lastViewedAt: r.last_viewed_at ? new Date(r.last_viewed_at).toISOString() : null,
    });
  }
  return map;
}
