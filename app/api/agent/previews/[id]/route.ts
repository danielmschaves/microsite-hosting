import argon2 from "argon2";
import { NextResponse } from "next/server";
import { requestBase } from "@/lib/url";
import { query, type DeploymentRow, type VersionRow, type DeploymentAccessMode } from "@/lib/db";
import { isFlagEnabled } from "@/lib/flags";
import { requireAgentScope } from "@/lib/agentAuthz";
import { deletePrefix } from "@/lib/storage";
import { transitionDeployment } from "@/lib/deployments";
import { badRequest, notFound } from "@/lib/agentErrors";
import { track } from "@/lib/events";

const ACCESS_MODES: DeploymentAccessMode[] = ["password", "organization", "hybrid", "inherit"];

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

interface PatchAccessBody {
  accessMode?: string;
  password?: string;
}

// PATCH /api/agent/previews/{id} — set_preview_access (preview:create, same
// scope as this route's existing DELETE). "password"/"hybrid" with a
// password given hashes it with argon2id (CD-15's NFR) and stores only the
// hash — the plaintext never touches the deployments row. "organization"
// and "inherit" clear any stored hash (inherit falls back to the site's own
// canViewSite policy, exactly today's preview-serving behavior).
export async function PATCH(
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

  const body: PatchAccessBody = await req.json().catch(() => ({}));
  if (!body.accessMode || !ACCESS_MODES.includes(body.accessMode as DeploymentAccessMode)) {
    return badRequest(`accessMode must be one of ${ACCESS_MODES.join(", ")}`);
  }
  const accessMode = body.accessMode as DeploymentAccessMode;

  let passwordHash: string | null = null;
  if (accessMode === "password" || accessMode === "hybrid") {
    if (body.password) {
      passwordHash = await argon2.hash(body.password, { type: argon2.argon2id });
    } else {
      // Keep any hash already set (e.g. re-toggling hybrid on without
      // re-sending the password); only clear it when moving away from a
      // password-bearing mode.
      const rows = await query<{ access_password_hash: string | null }>(
        "SELECT access_password_hash FROM deployments WHERE id = $1",
        [found.deployment.id],
      );
      passwordHash = rows[0]?.access_password_hash ?? null;
      if (!passwordHash) {
        return badRequest("password is required to set this access mode for the first time");
      }
    }
  }

  await query(
    "UPDATE deployments SET access_mode = $1, access_password_hash = $2 WHERE id = $3",
    [accessMode, passwordHash, found.deployment.id],
  );

  await track("preview_access_changed", {
    siteId: found.deployment.site_id,
    workspaceId: authRes.workspaceId,
    actor: authRes.email,
    actorType: "agent",
    meta: { tool: "set_preview_access", clientId: authRes.agentClientId, deploymentId: id, accessMode },
  });

  return NextResponse.json({ ok: true, accessMode });
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
