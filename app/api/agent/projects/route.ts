import { NextResponse } from "next/server";
import { isFlagEnabled } from "@/lib/flags";
import { requireAgentScope } from "@/lib/agentAuthz";
import { getWorkspacesFor } from "@/lib/teams";

export const runtime = "nodejs";

// GET /api/agent/projects — list_projects (project:read). "Projects" in the
// PRD's agent-facing vocabulary are this app's existing workspaces.
export async function GET(req: Request) {
  if (!(await isFlagEnabled("agent_gateway"))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const authRes = await requireAgentScope(req, "project:read", { rateLimitKind: "read" });
  if ("error" in authRes) return authRes.error;

  const workspaces = await getWorkspacesFor(authRes.email);
  return NextResponse.json({
    projects: workspaces.map((w) => ({
      id: w.id,
      name: w.name,
      plan: w.plan,
      myRole: w.my_role,
      memberCount: w.member_count,
    })),
  });
}
