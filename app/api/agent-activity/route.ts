import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireWorkspaceRole } from "@/lib/teams";

export const runtime = "nodejs";

// GET /api/agent-activity?workspaceId=... — recent agent-driven events for
// the Agent Console's activity badge. Same NotificationsBell polling shape
// (components/NotificationsBell.tsx), thin wrapper over the events table
// TeamPanel already queries for its human audit log.
export async function GET(req: Request) {
  const workspaceId = new URL(req.url).searchParams.get("workspaceId") || "";
  const res = await requireWorkspaceRole(workspaceId, "member");
  if ("error" in res) return res.error;

  const rows = await query<{
    type: string;
    actor: string | null;
    meta: Record<string, unknown>;
    created_at: Date;
  }>(
    `SELECT type, actor, meta, created_at FROM events
      WHERE workspace_id = $1 AND actor_type = 'agent'
        AND created_at > now() - interval '24 hours'
      ORDER BY created_at DESC
      LIMIT 50`,
    [workspaceId],
  );

  return NextResponse.json({
    items: rows.map((r) => ({
      type: r.type,
      actor: r.actor,
      meta: r.meta,
      at: new Date(r.created_at).toISOString(),
    })),
  });
}
