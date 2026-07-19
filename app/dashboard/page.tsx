import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { query } from "@/lib/db";
import { FREE_SITE_LIMIT, FREE_STORAGE_BYTES } from "@/lib/plan";
import { AppBar } from "@/components/AppBar";
import { SitesView, type SiteView } from "@/components/SitesView";

export const dynamic = "force-dynamic";

interface DashboardRow {
  id: string;
  slug: string;
  size_bytes: string;
  ttl_preset: string;
  expires_at: Date;
  viewer_count: string;
}

export default async function Dashboard() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) redirect("/");

  const rows = await query<DashboardRow>(
    `SELECT s.id, s.slug, s.size_bytes, s.ttl_preset, s.expires_at,
            (SELECT count(*) FROM site_viewers v WHERE v.site_id = s.id) AS viewer_count
       FROM sites s
      WHERE s.owner_email = $1 AND s.deleted_at IS NULL
      ORDER BY s.created_at DESC`,
    [email],
  );

  const base = process.env.NEXT_PUBLIC_BASE_URL || "";
  const sites: SiteView[] = rows.map((r) => {
    const viewers = Number(r.viewer_count);
    return {
      id: r.id,
      slug: r.slug,
      url: `${base}/s/${r.slug}`,
      sizeBytes: Number(r.size_bytes),
      ttlPreset: r.ttl_preset,
      expiresAt: new Date(r.expires_at).toISOString(),
      viewersLabel:
        viewers === 0 ? "Only me" : viewers === 1 ? "1 viewer" : `${viewers} viewers`,
    };
  });

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
      <SitesView sites={sites} />
    </>
  );
}
