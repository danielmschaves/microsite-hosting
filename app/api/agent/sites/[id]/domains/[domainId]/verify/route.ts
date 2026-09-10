import { NextResponse } from "next/server";
import { isFlagEnabled } from "@/lib/flags";
import { requireAgentScope } from "@/lib/agentAuthz";
import { agentOwnedSite } from "@/lib/agentSites";
import { verifyCustomDomain, toDomainView } from "@/lib/domains";
import { notFound } from "@/lib/agentErrors";
import { track } from "@/lib/events";

export const runtime = "nodejs";

// POST /api/agent/sites/{id}/domains/{domainId}/verify — verify_custom_domain
// (site:write). Idempotent re-check — safe for an agent to poll.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; domainId: string }> },
) {
  if (!(await isFlagEnabled("agent_gateway"))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const authRes = await requireAgentScope(req, "site:write", { rateLimitKind: "write" });
  if ("error" in authRes) return authRes.error;
  const { id, domainId } = await params;

  const site = await agentOwnedSite(id, authRes.workspaceId);
  if (!site) return notFound();

  const result = await verifyCustomDomain(domainId, site.id, authRes.email);
  if (!result.ok) {
    return NextResponse.json({ error: "invalid_request", message: result.error }, { status: result.status });
  }

  await track("agent_action", {
    siteId: site.id,
    workspaceId: authRes.workspaceId,
    actor: authRes.email,
    actorType: "agent",
    meta: { tool: "verify_custom_domain", clientId: authRes.agentClientId, hostname: result.domain.hostname },
  });

  return NextResponse.json({ domain: toDomainView(result.domain) });
}
