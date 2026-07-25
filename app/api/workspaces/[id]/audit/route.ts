import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireWorkspaceRole } from "@/lib/teams";
import { planForWorkspace } from "@/lib/plan";

export const runtime = "nodejs";

// GET — admin+: recent workspace activity from the events table (the audit
// log's substrate — no separate table). Window comes from the plan (30 days
// team tier); LIMIT 200 newest-first.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const res = await requireWorkspaceRole(id, "admin");
  if ("error" in res) return res.error;

  const auditDays = planForWorkspace(res.workspace).auditDays;
  if (auditDays === 0) {
    return NextResponse.json(
      { error: "Audit log requires the Team plan", upgradeUrl: `/teams/${id}` },
      { status: 402 },
    );
  }

  const rows = await query<{
    type: string;
    actor: string | null;
    meta: Record<string, unknown>;
    created_at: Date;
    slug: string | null;
  }>(
    `SELECT e.type, e.actor, e.meta, e.created_at, s.slug
       FROM events e
       LEFT JOIN sites s ON s.id = e.site_id
      WHERE e.workspace_id = $1
        AND e.type <> 'site_view'
        AND e.created_at > now() - make_interval(days => $2)
      ORDER BY e.created_at DESC
      LIMIT 200`,
    [id, auditDays],
  );

  return NextResponse.json({
    auditDays,
    entries: rows.map((r) => ({
      type: r.type,
      actor: r.actor,
      slug: r.slug,
      meta: r.meta,
      at: new Date(r.created_at).toISOString(),
    })),
  });
}
