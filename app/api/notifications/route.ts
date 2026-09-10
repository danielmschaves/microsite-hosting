import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The in-app bell: the caller's live sites expiring within 48h, plus (CD-17)
// any pending agent approval requests in workspaces the caller admins. Both
// are live conditions, not an inbox — no read-state, nothing to mark as
// seen; extending a site or deciding an approval simply removes it.
export async function GET() {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await query<{
    id: string;
    slug: string;
    expires_at: Date;
  }>(
    `SELECT id, slug, expires_at
       FROM sites
      WHERE lower(owner_email) = $1
        AND deleted_at IS NULL
        AND expires_at > now()
        AND expires_at <= now() + interval '48 hours'
      ORDER BY expires_at ASC`,
    [email],
  );

  const approvalRows = await query<{
    id: string;
    slug: string;
    action: string;
    workspace_id: string;
    expires_at: Date;
  }>(
    `SELECT a.id, s.slug, a.action, a.workspace_id, a.expires_at
       FROM approvals a
       JOIN sites s ON s.id = a.site_id
       JOIN workspace_members m ON m.workspace_id = a.workspace_id AND m.email = $1
      WHERE a.status = 'pending'
        AND a.expires_at > now()
        AND m.role IN ('admin','owner')
      ORDER BY a.expires_at ASC`,
    [email],
  );

  return NextResponse.json({
    items: rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      expiresAt: new Date(r.expires_at).toISOString(),
    })),
    pendingApprovals: approvalRows.map((a) => ({
      id: a.id,
      slug: a.slug,
      action: a.action,
      workspaceId: a.workspace_id,
      expiresAt: new Date(a.expires_at).toISOString(),
    })),
  });
}
