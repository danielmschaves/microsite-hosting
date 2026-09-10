import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/auth";
import { query, type SiteRow } from "@/lib/db";
import { getMembership, roleAtLeast } from "@/lib/teams";
import { listSiteDomains, toDomainView } from "@/lib/domains";
import { FREE_SITE_LIMIT, FREE_STORAGE_BYTES } from "@/lib/plan";
import { AppBar } from "@/components/AppBar";
import { DomainsPanel } from "@/components/DomainsPanel";

export const dynamic = "force-dynamic";

// /sites/[id]/domains — CD-21's Domains panel (DS-16). Owner or workspace
// admin, same authorization shape as authorizeSiteManage's allowWorkspaceAdmin.
export default async function SiteDomainsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) redirect("/");

  const rows = await query<SiteRow>(
    "SELECT * FROM sites WHERE id = $1 AND purged_at IS NULL",
    [id],
  ).catch(() => [] as SiteRow[]);
  const site = rows[0];
  if (!site) notFound();

  const isOwner = site.owner_email.toLowerCase() === email;
  if (!isOwner) {
    const role = site.workspace_id ? await getMembership(email, site.workspace_id) : null;
    if (!role || !roleAtLeast(role, "admin")) notFound();
  }

  const domains = await listSiteDomains(site.id);

  const mySites = await query<{ size_bytes: string }>(
    "SELECT size_bytes FROM sites WHERE owner_email = $1 AND deleted_at IS NULL",
    [email],
  );
  const usedBytes = mySites.reduce((s, r) => s + Number(r.size_bytes), 0);

  return (
    <>
      <AppBar
        email={email}
        name={session?.user?.name}
        active="sites"
        usedBytes={usedBytes}
        siteCount={mySites.length}
        siteLimit={FREE_SITE_LIMIT}
        storageLimitBytes={FREE_STORAGE_BYTES}
      />
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "30px 30px 100px" }}>
        <div style={{ marginBottom: 12 }}>
          <Link
            href={`/sites/${id}`}
            className="btn btn-ghost"
            style={{ padding: "5px 9px", font: "600 12px/1 var(--font-ui)" }}
          >
            <ArrowLeft size={14} />
            {site.slug}
          </Link>
        </div>
        <h1 style={{ font: "800 26px/1 var(--font-ui)", color: "var(--text)" }}>Custom domains</h1>
        <p style={{ font: "400 13.5px/1 var(--font-ui)", color: "var(--text-muted)", marginTop: 8, marginBottom: 24 }}>
          Point your own domain at <code className="mb-mono">{site.slug}</code>. The default{" "}
          <code className="mb-mono">/s/{site.slug}</code> link keeps working regardless.
        </p>
        <DomainsPanel siteId={site.id} domains={domains.map(toDomainView)} />
      </div>
    </>
  );
}
