import { NextResponse } from "next/server";
import { query, type VersionRow } from "@/lib/db";
import { isFlagEnabled } from "@/lib/flags";
import { requireAgentScope } from "@/lib/agentAuthz";
import { agentOwnedSite } from "@/lib/agentSites";
import { notFound } from "@/lib/agentErrors";

export const runtime = "nodejs";

// GET /api/agent/sites/{id}/versions — list_site_versions (site:read).
// Newest first; keyset pagination via ?before=<number> (a later release adds
// full cursor semantics once version history can grow large under R2+).
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isFlagEnabled("agent_gateway"))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const authRes = await requireAgentScope(req, "site:read", { rateLimitKind: "read" });
  if ("error" in authRes) return authRes.error;
  const { id } = await params;

  const site = await agentOwnedSite(id, authRes.workspaceId);
  if (!site) return notFound();

  const before = new URL(req.url).searchParams.get("before");
  const rows = await query<VersionRow>(
    before
      ? "SELECT * FROM versions WHERE site_id = $1 AND number < $2 AND number > 0 ORDER BY number DESC LIMIT 50"
      : "SELECT * FROM versions WHERE site_id = $1 AND number > 0 ORDER BY number DESC LIMIT 50",
    before ? [site.id, Number(before)] : [site.id],
  );

  return NextResponse.json({
    versions: rows.map((v) => ({
      number: v.number,
      source: v.source,
      authorEmail: v.author_email,
      actorType: v.actor_type,
      isCurrent: v.number === site.current_version,
      createdAt: new Date(v.created_at).toISOString(),
    })),
  });
}
