import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { query, type SiteRow } from "@/lib/db";
import { SignOut } from "@/components/AuthButtons";
import { UploadForm } from "@/components/UploadForm";
import { SiteList, type SiteView } from "@/components/SiteList";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    redirect("/");
  }

  const rows = await query<SiteRow>(
    `SELECT * FROM sites
      WHERE owner_email = $1 AND deleted_at IS NULL
      ORDER BY created_at DESC`,
    [email],
  );

  const base = process.env.NEXT_PUBLIC_BASE_URL || "";
  const sites: SiteView[] = rows.map((s) => ({
    id: s.id,
    slug: s.slug,
    url: `${base}/s/${s.slug}`,
    sizeBytes: Number(s.size_bytes),
    ttlPreset: s.ttl_preset,
    expiresAt: new Date(s.expires_at).toISOString(),
  }));

  return (
    <>
      <div className="header">
        <Link className="brand" href="/dashboard">
          Shipsite
        </Link>
        <div className="row" style={{ alignItems: "center" }}>
          <span className="muted" style={{ flex: "none" }}>
            {email}
          </span>
          <SignOut />
        </div>
      </div>
      <div className="container">
        <div className="panel">
          <h2>Upload a page</h2>
          <UploadForm />
        </div>

        <div className="panel">
          <h2>Your sites</h2>
          {sites.length === 0 ? (
            <p className="muted">
              No sites yet. Upload an HTML file to get a shareable link.
            </p>
          ) : (
            <SiteList sites={sites} />
          )}
        </div>
      </div>
    </>
  );
}
