import { NextResponse } from "next/server";
import { isFlagEnabled } from "@/lib/flags";
import { requireAgentScope } from "@/lib/agentAuthz";
import { agentOwnedSite } from "@/lib/agentSites";
import { query, type WorkspaceRow } from "@/lib/db";
import { planForWorkspace } from "@/lib/plan";
import { getSiteInsights } from "@/lib/insights";
import { notFound } from "@/lib/agentErrors";

export const runtime = "nodejs";

// GET /api/agent/sites/{id}/insights — get_site_insights (insights:read).
// Named viewers, not just counts — the R3 differentiator. Team-plan gated,
// same as the session route (both call lib/insights.ts directly).
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isFlagEnabled("agent_gateway"))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const authRes = await requireAgentScope(req, "insights:read", { rateLimitKind: "read" });
  if ("error" in authRes) return authRes.error;
  const { id } = await params;

  const site = await agentOwnedSite(id, authRes.workspaceId);
  if (!site) return notFound();

  const workspaceRows = await query<WorkspaceRow>("SELECT * FROM workspaces WHERE id = $1", [
    authRes.workspaceId,
  ]);
  const plan = planForWorkspace(workspaceRows[0] ?? null);
  if (!plan.insightsEnabled) {
    return NextResponse.json(
      {
        error: "plan_required",
        message: "Visitor insights requires the Team plan",
        upgradeUrl: `/teams/${authRes.workspaceId}`,
      },
      { status: 402 },
    );
  }

  const url = new URL(req.url);
  const days = Math.min(90, Math.max(1, Number(url.searchParams.get("days")) || 30));

  const insights = await getSiteInsights(site.id, days);
  return NextResponse.json(insights);
}
