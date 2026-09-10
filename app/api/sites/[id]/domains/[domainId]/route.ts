import { NextResponse } from "next/server";
import { authorizeSiteManage } from "@/lib/authz";
import { removeDomain, verifyCustomDomain, setPrimaryDomain, toDomainView } from "@/lib/domains";

export const runtime = "nodejs";

interface PatchBody {
  action?: "verify" | "set_primary";
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; domainId: string }> },
) {
  const { id, domainId } = await params;
  const authRes = await authorizeSiteManage(id, { allowWorkspaceAdmin: true });
  if ("error" in authRes) return authRes.error;

  const body: PatchBody = await req.json().catch(() => ({}));
  if (body.action === "verify") {
    const result = await verifyCustomDomain(domainId, authRes.site.id, authRes.email);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ domain: toDomainView(result.domain) });
  }
  if (body.action === "set_primary") {
    const result = await setPrimaryDomain(domainId, authRes.site.id);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Provide action: verify or set_primary" }, { status: 400 });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; domainId: string }> },
) {
  const { id, domainId } = await params;
  const authRes = await authorizeSiteManage(id, { allowWorkspaceAdmin: true });
  if ("error" in authRes) return authRes.error;

  const removed = await removeDomain(domainId, authRes.site.id, authRes.email);
  if (!removed) {
    return NextResponse.json({ error: "Domain not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
