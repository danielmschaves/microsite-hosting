import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import {
  query,
  type SiteRow,
  type SiteVersionRow,
  type WorkspaceRow,
} from "@/lib/db";
import { listPrefix, type StoredFile } from "@/lib/storage";
import { statsForSites } from "@/lib/events";
import {
  FREE_SITE_LIMIT,
  FREE_STORAGE_BYTES,
  planForWorkspace,
  allowedTtlPresets,
} from "@/lib/plan";
import { AppBar } from "@/components/AppBar";
import { ManagePanel } from "@/components/ManagePanel";

export const dynamic = "force-dynamic";

export default async function ManageSitePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  const email = session?.user?.email;
  if (!email) redirect("/");

  const rows = await query<SiteRow>(
    "SELECT * FROM sites WHERE id = $1 AND purged_at IS NULL",
    [id],
  ).catch(() => [] as SiteRow[]); // invalid uuid → treat as not found
  const site = rows[0];
  if (!site || site.owner_email.toLowerCase() !== email.toLowerCase()) {
    notFound();
  }

  const viewerRows = await query<{ viewer_email: string }>(
    "SELECT viewer_email FROM site_viewers WHERE site_id = $1 ORDER BY viewer_email",
    [id],
  );
  const stats = (await statsForSites([id])).get(id) ?? {
    views: 0,
    uniqueViewers: 0,
    lastViewedAt: null,
  };

  let files: StoredFile[] = [];
  try {
    files = await listPrefix(site.s3_prefix);
  } catch {
    // storage listing is cosmetic here; the panel renders without it
  }

  // App bar totals
  const all = await query<{ size_bytes: string }>(
    "SELECT size_bytes FROM sites WHERE owner_email = $1 AND deleted_at IS NULL",
    [email],
  );
  const usedBytes = all.reduce((s, r) => s + Number(r.size_bytes), 0);

  const indexName = site.index_key.slice(site.s3_prefix.length);

  const workspace: WorkspaceRow | null = site.workspace_id
    ? (
        await query<WorkspaceRow>("SELECT * FROM workspaces WHERE id = $1", [
          site.workspace_id,
        ])
      )[0] ?? null
    : null;
  const plan = planForWorkspace(workspace);
  const allowedTtls = allowedTtlPresets(plan, workspace?.max_ttl_preset ?? null);

  const versionRows = await query<SiteVersionRow>(
    "SELECT * FROM site_versions WHERE site_id = $1 ORDER BY version DESC",
    [id],
  ).catch(() => [] as SiteVersionRow[]);

  return (
    <>
      <AppBar
        email={email}
        name={session.user?.name}
        active="sites"
        usedBytes={usedBytes}
        siteCount={all.length}
        siteLimit={FREE_SITE_LIMIT}
        storageLimitBytes={FREE_STORAGE_BYTES}
      />
      <ManagePanel
        site={{
          id: site.id,
          slug: site.slug,
          url: `/s/${site.slug}`,
          sizeBytes: Number(site.size_bytes),
          pageCount: Number(site.page_count),
          ttlPreset: site.ttl_preset,
          expiresAt: new Date(site.expires_at).toISOString(),
          createdAt: new Date(site.created_at).toISOString(),
          trashed: site.deleted_at !== null,
          indexName,
          visibility: site.visibility,
          workspaceName: workspace?.name ?? null,
          currentVersion: Number(site.current_version),
        }}
        allowedTtls={allowedTtls}
        viewers={viewerRows.map((v) => v.viewer_email)}
        stats={stats}
        files={files}
        versions={versionRows.map((v) => ({
          version: Number(v.version),
          sizeBytes: Number(v.size_bytes),
          pageCount: Number(v.page_count),
          createdBy: v.created_by,
          createdAt: new Date(v.created_at).toISOString(),
        }))}
        versionLimit={plan.versionLimit}
      />
    </>
  );
}
