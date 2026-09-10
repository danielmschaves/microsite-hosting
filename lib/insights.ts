import { query } from "./db";

// ---------------------------------------------------------------------------
// Visitor insights (PRD v2.0 CD-23/E10). Deliberately NOT a separate
// rollups/ETL table — `events` is already the single source of truth for
// site_view rows (lib/events.ts's statsForSites does the same direct-query
// pattern for the dashboard's view counts), and at this product's actual
// scale a GROUP BY at read time is simpler and just as fast as maintaining a
// second table that could drift from it. Named viewers only ever include
// authenticated actors — anonymous public views aggregate into counts only,
// never a name, matching E10's privacy line exactly.
// ---------------------------------------------------------------------------

export interface SiteInsights {
  totalViews: number;
  uniqueViewers: number;
  viewsOverTime: { date: string; count: number }[];
  topPages: { path: string; count: number }[];
  referrers: { referrer: string; count: number }[];
  namedViewers: { email: string; views: number; lastViewedAt: string }[];
}

export async function getSiteInsights(siteId: string, days: number): Promise<SiteInsights> {
  const totalsRow = await query<{ total: string; unique: string }>(
    `SELECT count(*) AS total, count(DISTINCT actor) AS unique
       FROM events
      WHERE site_id = $1 AND type = 'site_view' AND created_at > now() - make_interval(days => $2)`,
    [siteId, days],
  );

  const overTime = await query<{ day: Date; count: string }>(
    `SELECT date_trunc('day', created_at) AS day, count(*) AS count
       FROM events
      WHERE site_id = $1 AND type = 'site_view' AND created_at > now() - make_interval(days => $2)
      GROUP BY day
      ORDER BY day ASC`,
    [siteId, days],
  );

  const pages = await query<{ path: string; count: string }>(
    `SELECT coalesce(meta->>'path', 'index') AS path, count(*) AS count
       FROM events
      WHERE site_id = $1 AND type = 'site_view' AND created_at > now() - make_interval(days => $2)
      GROUP BY path
      ORDER BY count DESC
      LIMIT 10`,
    [siteId, days],
  );

  const referrers = await query<{ referrer: string; count: string }>(
    `SELECT meta->>'referrer' AS referrer, count(*) AS count
       FROM events
      WHERE site_id = $1 AND type = 'site_view' AND created_at > now() - make_interval(days => $2)
        AND meta->>'referrer' IS NOT NULL
      GROUP BY referrer
      ORDER BY count DESC
      LIMIT 10`,
    [siteId, days],
  );

  const named = await query<{ actor: string; count: string; last_viewed_at: Date }>(
    `SELECT actor, count(*) AS count, max(created_at) AS last_viewed_at
       FROM events
      WHERE site_id = $1 AND type = 'site_view' AND created_at > now() - make_interval(days => $2)
        AND actor IS NOT NULL
      GROUP BY actor
      ORDER BY last_viewed_at DESC
      LIMIT 50`,
    [siteId, days],
  );

  return {
    totalViews: Number(totalsRow[0]?.total ?? 0),
    uniqueViewers: Number(totalsRow[0]?.unique ?? 0),
    viewsOverTime: overTime.map((r) => ({
      date: new Date(r.day).toISOString().slice(0, 10),
      count: Number(r.count),
    })),
    topPages: pages.map((r) => ({ path: r.path, count: Number(r.count) })),
    referrers: referrers.map((r) => ({ referrer: r.referrer, count: Number(r.count) })),
    namedViewers: named.map((r) => ({
      email: r.actor,
      views: Number(r.count),
      lastViewedAt: new Date(r.last_viewed_at).toISOString(),
    })),
  };
}
