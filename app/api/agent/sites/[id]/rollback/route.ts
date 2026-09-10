import { NextResponse } from "next/server";
import { query, type WorkspaceRow, type PublishMode } from "@/lib/db";
import { isFlagEnabled } from "@/lib/flags";
import { requireAgentScope } from "@/lib/agentAuthz";
import { agentOwnedSite } from "@/lib/agentSites";
import { rollbackToVersion } from "@/lib/siteMutations";
import { createConfirmToken, verifyConfirmToken } from "@/lib/agentConfirm";
import { withIdempotency } from "@/lib/idempotency";
import { badRequest, notFound } from "@/lib/agentErrors";

export const runtime = "nodejs";

// CD-16 NFR: rollback_to_version's confirm token lives 10 minutes, not the default 5.
const PUBLISH_CONFIRM_TTL_MS = 10 * 60 * 1000;

interface RollbackBody {
  version?: number;
  confirmToken?: string;
}

// POST /api/agent/sites/{id}/rollback — rollback_to_version
// (rollback:confirm), publishes without a preview by design (PRD §9.2:
// "publishes without preview"). Gated by the workspace's publish_mode
// (CD-16), same three-way branch as the publish route: "direct" executes
// immediately, "confirm" is today's two-step flow (10-minute TTL), and
// "approval" is always rejected here — only request_publish + a human
// decision on POST /api/approvals/{id} can execute it. Mandatory
// Idempotency-Key on the execute step, regardless of publish_mode. Shares
// rollbackToVersion with the human rollback route (lib/siteMutations.ts) —
// same transactional row-locking.
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

  const workspaceRows = site.workspace_id
    ? await query<WorkspaceRow>("SELECT * FROM workspaces WHERE id = $1", [site.workspace_id])
    : [];
  const mode: PublishMode = workspaceRows[0]?.publish_mode ?? "confirm";

  if (mode === "approval") {
    return NextResponse.json(
      {
        error: "approval_required",
        message:
          "This workspace requires human approval to roll back. Call request_publish to start a review.",
        publishMode: "approval",
      },
      { status: 400 },
    );
  }

  const bodyText = await req.text();
  const body: RollbackBody = bodyText ? JSON.parse(bodyText) : {};
  const version = Number(body.version);
  if (!Number.isInteger(version) || version < 1) {
    return badRequest("Provide { version }");
  }

  if (mode === "confirm" && !body.confirmToken) {
    return NextResponse.json({
      confirmToken: createConfirmToken("rollback_to_version", site.id, authRes.tokenId, PUBLISH_CONFIRM_TTL_MS),
      summary: { slug: site.slug, from: site.current_version, to: version },
    });
  }

  if (mode === "confirm") {
    const verified = verifyConfirmToken(body.confirmToken!, "rollback_to_version", site.id, authRes.tokenId);
    if (!verified.ok) {
      return NextResponse.json(
        { error: "invalid_confirm_token", message: verified.reason },
        { status: 400 },
      );
    }
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
