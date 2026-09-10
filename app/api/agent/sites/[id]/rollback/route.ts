import { NextResponse } from "next/server";
import { isFlagEnabled } from "@/lib/flags";
import { requireAgentScope } from "@/lib/agentAuthz";
import { agentOwnedSite } from "@/lib/agentSites";
import { rollbackToVersion } from "@/lib/siteMutations";
import { createConfirmToken, verifyConfirmToken } from "@/lib/agentConfirm";
import { withIdempotency } from "@/lib/idempotency";
import { badRequest, notFound } from "@/lib/agentErrors";

export const runtime = "nodejs";

interface RollbackBody {
  version?: number;
  confirmToken?: string;
}

// POST /api/agent/sites/{id}/rollback — rollback_to_version
// (rollback:confirm), two-step confirmation, publishes without a preview by
// design (PRD §9.2: "publishes without preview"). Mandatory Idempotency-Key
// on step 2 per the NFR table. Shares rollbackToVersion with the human
// rollback route (lib/siteMutations.ts) — same transactional row-locking.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isFlagEnabled("agent_gateway"))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const authRes = await requireAgentScope(req, "rollback:confirm", { rateLimitKind: "write" });
  if ("error" in authRes) return authRes.error;
  const { id } = await params;

  const site = await agentOwnedSite(id, authRes.workspaceId);
  if (!site) return notFound();

  const bodyText = await req.text();
  const body: RollbackBody = bodyText ? JSON.parse(bodyText) : {};
  const version = Number(body.version);
  if (!Number.isInteger(version) || version < 1) {
    return badRequest("Provide { version }");
  }

  if (!body.confirmToken) {
    return NextResponse.json({
      confirmToken: createConfirmToken("rollback_to_version", site.id, authRes.tokenId),
      summary: { slug: site.slug, from: site.current_version, to: version },
    });
  }

  const verified = verifyConfirmToken(body.confirmToken, "rollback_to_version", site.id, authRes.tokenId);
  if (!verified.ok) {
    return NextResponse.json(
      { error: "invalid_confirm_token", message: verified.reason },
      { status: 400 },
    );
  }

  const idempotencyKey = req.headers.get("idempotency-key");
  if (!idempotencyKey) {
    return badRequest("Idempotency-Key header is required for rollback_to_version");
  }

  const result = await withIdempotency(
    { key: idempotencyKey, tokenId: authRes.tokenId, method: "POST", url: req.url, bodyText },
    () =>
      rollbackToVersion(site, authRes.email, version, {
        via: "agent",
        clientId: authRes.agentClientId,
        actorType: "agent",
      }),
  );

  return NextResponse.json(result.body, { status: result.status });
}
