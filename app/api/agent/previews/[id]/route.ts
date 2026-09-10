import { NextResponse } from "next/server";
import { requestBase } from "@/lib/url";
import { query, type DeploymentRow, type VersionRow } from "@/lib/db";
import { isFlagEnabled } from "@/lib/flags";
import { requireAgentScope } from "@/lib/agentAuthz";
import { deletePrefix } from "@/lib/storage";
import { transitionDeployment } from "@/lib/deployments";
import { notFound } from "@/lib/agentErrors";
import { track } from "@/lib/events";

export const runtime = "nodejs";

async function workspacePreview(
  id: string,
  workspaceId: string,
): Promise<{ deployment: DeploymentRow; slug: string } | null> {
  let rows: (DeploymentRow & { slug: string })[] = [];
  try {
    rows = await query<DeploymentRow & { slug: string }>(
      `SELECT d.*, s.slug FROM deployments d
         JOIN sites s ON s.id = d.site_id
        WHERE d.id = $1 AND s.workspace_id = $2 AND d.target = 'preview'`,
      [id, workspaceId],
    );
  } catch {
    return null; // invalid uuid
  }
  const row = rows[0];
  return row ? { deployment: row, slug: row.slug } : null;
}

// GET /api/agent/previews/{id} — get_preview_status (preview:read). Long-poll
// friendly: cheap read, callers poll this until status leaves
// queued/building.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isFlagEnabled("agent_gateway"))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const authRes = await requireAgentScope(req, "preview:read", { rateLimitKind: "read" });
  if ("error" in authRes) return authRes.error;
  const { id } = await params;

  const found = await workspacePreview(id, authRes.workspaceId);
  if (!found) return notFound();

  const base = requestBase(req);
  return NextResponse.json({
    deploymentId: found.deployment.id,
    status: found.deployment.status,
    previewUrl: `${base}/s/${found.slug}/preview/${found.deployment.id}/`,
    error: found.deployment.error,
    createdAt: new Date(found.deployment.created_at).toISOString(),
    publishedAt: found.deployment.published_at ? new Date(found.deployment.published_at).toISOString() : null,
  });
}

// DELETE /api/agent/previews/{id} — delete_preview (preview:create). Soft
// delete: deletes the preview's storage and cancels the deployment row.
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isFlagEnabled("agent_gateway"))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const authRes = await requireAgentScope(req, "preview:create", { rateLimitKind: "write" });
  if ("error" in authRes) return authRes.error;
  const { id } = await params;

  const found = await workspacePreview(id, authRes.workspaceId);
  if (!found) return notFound();
  if (found.deployment.status === "canceled") {
    return NextResponse.json({ ok: true, alreadyDeleted: true });
  }

  const versionRows = await query<VersionRow>("SELECT * FROM versions WHERE id = $1", [
    found.deployment.version_id,
  ]);
  if (versionRows[0]) {
    await deletePrefix(versionRows[0].storage_key).catch(() => {});
  }
  await transitionDeployment(found.deployment.id, "canceled");

  await track("agent_action", {
    siteId: found.deployment.site_id,
    workspaceId: authRes.workspaceId,
    actor: authRes.email,
    actorType: "agent",
    meta: { tool: "delete_preview", clientId: authRes.agentClientId, deploymentId: id },
  });

  return NextResponse.json({ ok: true });
}
