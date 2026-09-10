import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/auth";
import { query, type WorkspaceRow, type ApprovalRow } from "@/lib/db";
import { getMembership, roleAtLeast } from "@/lib/teams";
import { isFlagEnabled } from "@/lib/flags";
import { FREE_SITE_LIMIT, FREE_STORAGE_BYTES } from "@/lib/plan";
import { AppBar } from "@/components/AppBar";
import { ApprovalsPanel, type ApprovalItem } from "@/components/ApprovalsPanel";

export const dynamic = "force-dynamic";

// Approvals inbox (CD-17): admin-only, nested under the workspace since
// approvals are workspace-scoped. Gated on the same agent_console_ui flag
// that already gates /teams/[id]/agents — one admin-surface flag, not a
// second one, per the R2 plan.
export default async function TeamApprovalsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) redirect("/");

  if (!(await isFlagEnabled("agent_console_ui", id))) {
    notFound();
  }

  const rows = await query<WorkspaceRow>("SELECT * FROM workspaces WHERE id = $1", [id]).catch(
    () => [] as WorkspaceRow[],
  );
  const workspace = rows[0];
  if (!workspace) notFound();

  const myRole = await getMembership(email, id);
  if (!myRole) notFound();
  const isAdmin = roleAtLeast(myRole, "admin");

  const pending = isAdmin
    ? await query<ApprovalRow & { slug: string }>(
        `SELECT a.*, s.slug FROM approvals a
           JOIN sites s ON s.id = a.site_id
          WHERE a.workspace_id = $1 AND a.status = 'pending' AND a.expires_at > now()
          ORDER BY a.created_at ASC`,
        [id],
      )
    : [];

  const items: ApprovalItem[] = pending.map((a) => ({
    id: a.id,
    slug: a.slug,
    action: a.action,
    requestedBy: a.requested_by,
    message: a.message,
    targetVersion: a.target_version,
    expiresAt: new Date(a.expires_at).toISOString(),
  }));

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
        active="teams"
        usedBytes={usedBytes}
        siteCount={mySites.length}
        siteLimit={FREE_SITE_LIMIT}
        storageLimitBytes={FREE_STORAGE_BYTES}
      />
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "30px 30px 100px" }}>
        <div style={{ marginBottom: 12 }}>
          <Link
            href={`/teams/${id}`}
            className="btn btn-ghost"
            style={{ padding: "5px 9px", font: "600 12px/1 var(--font-ui)" }}
          >
            <ArrowLeft size={14} />
            {workspace.name}
          </Link>
        </div>
        <h1 style={{ font: "800 26px/1 var(--font-ui)", color: "var(--text)" }}>Approvals</h1>
        <p
          style={{
            font: "400 13.5px/1 var(--font-ui)",
            color: "var(--text-muted)",
            marginTop: 8,
            marginBottom: 24,
          }}
        >
          Publish and rollback requests from agent tokens, held for a human decision. Requests
          expire after 72 hours.
        </p>
        {isAdmin ? (
          <ApprovalsPanel workspaceId={id} items={items} />
        ) : (
          <div className="card" style={{ padding: 20 }}>
            <div style={{ font: "400 13.5px/1.5 var(--font-ui)", color: "var(--text-muted)" }}>
              Only workspace admins can review approval requests.
            </div>
          </div>
        )}
      </div>
    </>
  );
}
