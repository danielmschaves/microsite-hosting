import { NextResponse } from "next/server";
import { authorizeSiteManage } from "@/lib/authz";
import { listSiteDomains, addCustomDomain, toDomainView } from "@/lib/domains";

export const runtime = "nodejs";

// GET/POST /api/sites/{id}/domains — session-authenticated (owner or
// workspace admin, mirroring every other site-mutation route). Backs the
// Domains panel at /sites/[id]/domains.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authRes = await authorizeSiteManage((await params).id, { allowWorkspaceAdmin: true });
  if ("error" in authRes) return authRes.error;

  const domains = await listSiteDomains(authRes.site.id);
  return NextResponse.json({ domains: domains.map(toDomainView) });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authRes = await authorizeSiteManage((await params).id, { allowWorkspaceAdmin: true });
  if ("error" in authRes) return authRes.error;

  const body = await req.json().catch(() => ({}));
  const hostname = typeof body.hostname === "string" ? body.hostname : "";
  if (!hostname) {
    return NextResponse.json({ error: "Provide hostname" }, { status: 400 });
  }

  const result = await addCustomDomain({
    siteId: authRes.site.id,
    hostname,
    createdBy: authRes.email,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ domain: toDomainView(result.domain) }, { status: 201 });
}
