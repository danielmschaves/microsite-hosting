import { NextResponse } from "next/server";
import { requireWorkspaceRole } from "@/lib/teams";
import { revokeAgentToken } from "@/lib/agentTokens";

export const runtime = "nodejs";

// DELETE /api/agent-tokens/{id}?workspaceId=... — revoke an agent token.
// Session-gated, admin-only (revoking another member's agent token needs
// admin, matching TeamPanel's other admin-gated sections). Effective on the
// next call for free — revoked_at is checked in verifyAgentBearer every
// request, no cache to invalidate.
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const workspaceId = new URL(req.url).searchParams.get("workspaceId") || "";
  const res = await requireWorkspaceRole(workspaceId, "admin");
  if ("error" in res) return res.error;

  const ok = await revokeAgentToken(id, workspaceId);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true, revoked: true });
}
