import { NextResponse } from "next/server";
import { isFlagEnabled } from "@/lib/flags";
import { requireAgentScope } from "@/lib/agentAuthz";
import { agentOwnedSite } from "@/lib/agentSites";
import { listSiteDomains, addCustomDomain, toDomainView } from "@/lib/domains";
import { badRequest, notFound } from "@/lib/agentErrors";
import { track } from "@/lib/events";

export const runtime = "nodejs";

// GET /api/agent/sites/{id}/domains — list_site_domains (site:read).
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

  const domains = await listSiteDomains(site.id);
  return NextResponse.json({ domains: domains.map(toDomainView) });
}

interface AddDomainBody {
  hostname?: string;
}

// POST /api/agent/sites/{id}/domains — add_custom_domain (site:write).
// Returns the exact DNS records to create (CNAME/ALIAS/ANAME + the TXT
// ownership challenge) — the same records the session-based Domains panel
// shows, since both paths go through lib/domains.ts's addCustomDomain.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isFlagEnabled("agent_gateway"))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const authRes = await requireAgentScope(req, "site:write", { rateLimitKind: "write" });
  if ("error" in authRes) return authRes.error;
  const { id } = await params;

  const site = await agentOwnedSite(id, authRes.workspaceId);
  if (!site) return notFound();

  const body: AddDomainBody = await req.json().catch(() => ({}));
  if (!body.hostname) {
    return badRequest("Provide hostname");
  }

  const result = await addCustomDomain({
    siteId: site.id,
    hostname: body.hostname,
    createdBy: authRes.email,
  });
  if (!result.ok) {
    return NextResponse.json({ error: "invalid_request", message: result.error }, { status: result.status });
  }

  await track("agent_action", {
    siteId: site.id,
    workspaceId: authRes.workspaceId,
    actor: authRes.email,
    actorType: "agent",
    meta: { tool: "add_custom_domain", clientId: authRes.agentClientId, hostname: result.domain.hostname },
  });

  return NextResponse.json({ domain: toDomainView(result.domain) }, { status: 201 });
}
