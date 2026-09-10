import { NextResponse } from "next/server";
import { requestBase } from "@/lib/url";
import { query, type DeploymentRow, type SiteVersionRow } from "@/lib/db";
import { isFlagEnabled } from "@/lib/flags";
import { requireAgentScope } from "@/lib/agentAuthz";
import { agentOwnedSite } from "@/lib/agentSites";
import { badRequest, notFound } from "@/lib/agentErrors";
import { track } from "@/lib/events";
import { sendEmail, approvalRequestedEmail } from "@/lib/email";

export const runtime = "nodejs";

interface RequestBody {
  action?: "publish" | "rollback";
  deploymentId?: string;
  targetVersion?: number;
  ttlOverride?: string;
  message?: string;
}

// POST /api/agent/sites/{id}/publish/request — request_publish
// (publish:request). The only path past a publish_mode='approval'
// workspace's wall in the publish/rollback routes: creates a pending
// `approvals` row for a human admin to decide on POST /api/approvals/{id}.
// Covers both publish and rollback requests via one `action` discriminator
// — deliberately the only route that ever inserts into `approvals`, so
// "agents cannot self-approve" has one structural home instead of being
// re-checked ad hoc.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isFlagEnabled("agent_gateway"))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const authRes = await requireAgentScope(req, "publish:request", { rateLimitKind: "write" });
  if ("error" in authRes) return authRes.error;
  const { id } = await params;

  const site = await agentOwnedSite(id, authRes.workspaceId);
  if (!site) return notFound();
  if (!site.workspace_id) {
    return badRequest("Approvals require the site to belong to a workspace");
  }

  const body: RequestBody = await req.json().catch(() => ({}));
  const action = body.action === "rollback" ? "rollback" : "publish";

  let deploymentId: string | null = null;
  let targetVersion: number | null = null;

  if (action === "rollback") {
    const version = Number(body.targetVersion);
    if (!Number.isInteger(version) || version < 1) {
      return badRequest("Provide targetVersion for a rollback request");
    }
    const rows = await query<SiteVersionRow>(
      "SELECT * FROM site_versions WHERE site_id = $1 AND version = $2",
      [site.id, version],
    );
    if (!rows[0]) {
      return badRequest("targetVersion not found (older versions are pruned)");
    }
    targetVersion = version;
  } else if (body.deploymentId) {
    const rows = await query<DeploymentRow>(
      `SELECT * FROM deployments
        WHERE id = $1 AND site_id = $2 AND target = 'preview' AND status = 'ready'`,
      [body.deploymentId, site.id],
    );
    if (!rows[0]) {
      return badRequest("deploymentId does not name a ready preview for this site");
    }
    deploymentId = rows[0].id;
  }

  const dedupe = await query<{ id: string }>(
    `SELECT id FROM approvals
      WHERE site_id = $1 AND action = $2 AND status = 'pending' AND expires_at > now()
      LIMIT 1`,
    [site.id, action],
  );
  if (dedupe[0]) {
    return NextResponse.json(
      {
        error: "already_pending",
        approvalId: dedupe[0].id,
        message: "A request for this action is already pending.",
      },
      { status: 409 },
    );
  }

  const inserted = await query<{ id: string }>(
    `INSERT INTO approvals
       (workspace_id, site_id, action, deployment_id, target_version, ttl_override, requested_by, agent_client_id, message, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now() + interval '72 hours')
     RETURNING id`,
    [
      site.workspace_id,
      site.id,
      action,
      deploymentId,
      targetVersion,
      body.ttlOverride ?? null,
      authRes.email,
      authRes.agentClientId,
      body.message ?? null,
    ],
  );
  const approvalId = inserted[0].id;

  await track("approval_requested", {
    siteId: site.id,
    workspaceId: site.workspace_id,
    actor: authRes.email,
    actorType: "agent",
    meta: { approvalId, action, clientId: authRes.agentClientId },
  });

  // Notify every admin+ member — best-effort, degrades to a logged no-op
  // exactly like every other email in this codebase (lib/email.ts).
  const base = requestBase(req);
  const approvalUrl = `${base}/teams/${site.workspace_id}/approvals`;
  const admins = await query<{ email: string }>(
    "SELECT email FROM workspace_members WHERE workspace_id = $1 AND role IN ('admin','owner')",
    [site.workspace_id],
  );
  for (const admin of admins) {
    const msg = approvalRequestedEmail({
      slug: site.slug,
      action,
      requestedBy: authRes.email,
      approvalUrl,
    });
    await sendEmail({ to: admin.email, ...msg });
  }

  return NextResponse.json({ approvalId, approvalUrl }, { status: 201 });
}
