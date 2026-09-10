import { NextResponse } from "next/server";
import { query, type ApprovalRow } from "@/lib/db";
import { isFlagEnabled } from "@/lib/flags";
import { requireAgentScope } from "@/lib/agentAuthz";
import { notFound } from "@/lib/agentErrors";

export const runtime = "nodejs";

// GET /api/agent/approvals/{id} — get_approval_status (publish:request).
// The scope matches request_publish's, but this route is read-only, so it
// uses the cheap 120/min read bucket instead of the 20/min write bucket.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isFlagEnabled("agent_gateway"))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const authRes = await requireAgentScope(req, "publish:request", { rateLimitKind: "read" });
  if ("error" in authRes) return authRes.error;
  const { id } = await params;

  let rows: ApprovalRow[] = [];
  try {
    rows = await query<ApprovalRow>(
      "SELECT * FROM approvals WHERE id = $1 AND workspace_id = $2",
      [id, authRes.workspaceId],
    );
  } catch {
    return notFound(); // invalid uuid
  }
  const approval = rows[0];
  if (!approval) return notFound();

  return NextResponse.json({
    approvalId: approval.id,
    action: approval.action,
    status: approval.status,
    decidedBy: approval.decided_by,
    decidedAt: approval.decided_at ? new Date(approval.decided_at).toISOString() : null,
    decisionNote: approval.decision_note,
    resultingVersion: approval.resulting_version,
    expiresAt: new Date(approval.expires_at).toISOString(),
  });
}
