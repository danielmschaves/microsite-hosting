import { NextResponse } from "next/server";
import { authorizeSiteManage } from "@/lib/authz";
import { query, type WorkspaceRow } from "@/lib/db";
import { planForWorkspace } from "@/lib/plan";
import { getSiteInsights } from "@/lib/insights";

export const runtime = "nodejs";

// GET /api/sites/{id}/insights — session-authenticated (owner or workspace
// admin). Team-plan gated (PRD §10) — same 402+upgradeUrl shape used
// everywhere else in this app for a plan gate. Backs /sites/[id]/insights.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authRes = await authorizeSiteManage((await params).id, { allowWorkspaceAdmin: true });
  if ("error" in authRes) return authRes.error;

  const workspaceRows = authRes.site.workspace_id
    ? await query<WorkspaceRow>("SELECT * FROM workspaces WHERE id = $1", [authRes.site.workspace_id])
    : [];
  const plan = planForWorkspace(workspaceRows[0] ?? null);
  if (!plan.insightsEnabled) {
    return NextResponse.json(
      {
        error: "Visitor insights requires the Team plan",
        upgradeUrl: authRes.site.workspace_id ? `/teams/${authRes.site.workspace_id}` : "/teams",
      },
      { status: 402 },
    );
  }

  const url = new URL(req.url);
  const days = Math.min(90, Math.max(1, Number(url.searchParams.get("days")) || 30));

  const insights = await getSiteInsights(authRes.site.id, days);
  return NextResponse.json(insights);
}
