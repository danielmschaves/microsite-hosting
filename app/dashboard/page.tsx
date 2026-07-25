import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { query } from "@/lib/db";
import { statsForSites } from "@/lib/events";
import {
  FREE_SITE_LIMIT,
  FREE_STORAGE_BYTES,
  TRASH_DAYS,
  planForWorkspace,
  allowedTtlPresets,
} from "@/lib/plan";
import type { WorkspaceRow } from "@/lib/db";
import { AppBar } from "@/components/AppBar";
import { SitesView, type SiteView, type TrashView, type TeamSiteView } from "@/components/SitesView";

export const dynamic = "force-dynamic";

interface DashboardRow {
  id: string;
  slug: string;
  size_bytes: string;
  page_count: number;
  ttl_preset: string;
  expires_at: Date;
  viewer_count: string;
  workspace_id: string | null;
}

interface TrashRow {
  id: string;
  slug: string;
  size_bytes: string;
  deleted_at: Date;
}

export default async function Dashboard() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) redirect("/");

  const rows = await query<DashboardRow>(
    `SELECT s.id, s.slug, s.size_bytes, s.page_count, s.ttl_preset, s.expires_at, s.workspace_id,
            (SELECT count(*) FROM site_viewers v WHERE v.site_id = s.id) AS viewer_count
       FROM sites s
      WHERE s.owner_email = $1 AND s.deleted_at IS NULL
      ORDER BY s.created_at DESC`,
    [email],
  );

  // Per-site TTL options depend on the site's workspace plan + policy.
  const wsIds = Array.from(
    new Set(rows.map((r) => r.workspace_id).filter((x): x is string => Boolean(x))),
  );
  const wsRows = wsIds.length
    ? await query<WorkspaceRow>("SELECT * FROM workspaces WHERE id = ANY($1::uuid[])", [wsIds])
    : [];
  const wsById = new Map(wsRows.map((w) => [w.id, w]));
  const ttlsFor = (workspaceId: string | null): string[] => {
    const ws = workspaceId ? wsById.get(workspaceId) ?? null : null;
    return allowedTtlPresets(planForWorkspace(ws), ws?.max_ttl_preset ?? null);
  };

  const trashRows = await query<TrashRow>(
    `SELECT id, slug, size_bytes, deleted_at
       FROM sites
      WHERE owner_email = $1 AND deleted_at IS NOT NULL AND purged_at IS NULL
      ORDER BY deleted_at DESC`,
    [email],
  );

  // Team sites shared with me (visibility='team' in my workspaces, not mine).
  const teamRows = await query<{
    id: string;
    slug: string;
    owner_email: string;
    size_bytes: string;
    page_count: number;
    expires_at: Date;
    workspace_name: string;
  }>(
    `SELECT s.id, s.slug, s.owner_email, s.size_bytes, s.page_count, s.expires_at,
            w.name AS workspace_name
       FROM sites s
       JOIN workspaces w ON w.id = s.workspace_id
       JOIN workspace_members m ON m.workspace_id = s.workspace_id AND m.email = $1
      WHERE s.visibility = 'team'
        AND s.deleted_at IS NULL
        AND s.expires_at > now()
        AND lower(s.owner_email) <> $1
      ORDER BY s.created_at DESC`,
    [email.toLowerCase()],
  );

  const stats = await statsForSites(rows.map((r) => r.id));

  const base = process.env.NEXT_PUBLIC_BASE_URL || "";
  const sites: SiteView[] = rows.map((r) => {
    const viewers = Number(r.viewer_count);
    const s = stats.get(r.id);
    return {
      id: r.id,
      slug: r.slug,
      url: `${base}/s/${r.slug}`,
      sizeBytes: Number(r.size_bytes),
      pageCount: Number(r.page_count),
      ttlPreset: r.ttl_preset,
      expiresAt: new Date(r.expires_at).toISOString(),
      viewersLabel:
        viewers === 0 ? "Only me" : viewers === 1 ? "1 viewer" : `${viewers} viewers`,
      views: s?.views ?? 0,
      lastViewedAt: s?.lastViewedAt ?? null,
      allowedTtls: ttlsFor(r.workspace_id),
    };
  });

  const trash: TrashView[] = trashRows.map((r) => ({
    id: r.id,
    slug: r.slug,
    sizeBytes: Number(r.size_bytes),
    purgeAt: new Date(
      new Date(r.deleted_at).getTime() + TRASH_DAYS * 24 * 3600 * 1000,
    ).toISOString(),
  }));

  const teamSites: TeamSiteView[] = teamRows.map((r) => ({
    id: r.id,
    slug: r.slug,
    url: `${base}/s/${r.slug}`,
    owner: r.owner_email,
    sizeBytes: Number(r.size_bytes),
    pageCount: Number(r.page_count),
    expiresAt: new Date(r.expires_at).toISOString(),
    workspaceName: r.workspace_name,
  }));

  const usedBytes = sites.reduce((sum, s) => sum + s.sizeBytes, 0);

  return (
    <>
      <AppBar
        email={email}
        name={session.user?.name}
        active="sites"
        usedBytes={usedBytes}
        siteCount={sites.length}
        siteLimit={FREE_SITE_LIMIT}
        storageLimitBytes={FREE_STORAGE_BYTES}
      />
      <SitesView sites={sites} trash={trash} teamSites={teamSites} />
    </>
  );
}
