import { NextResponse } from "next/server";
import { requestBase } from "@/lib/url";
import { isFlagEnabled } from "@/lib/flags";
import { requireAgentScope } from "@/lib/agentAuthz";
import { agentOwnedSite } from "@/lib/agentSites";
import { listPrefix, getObject, putObject } from "@/lib/storage";
import { query } from "@/lib/db";
import { createDeployment, transitionDeployment } from "@/lib/deployments";
import { badRequest, notFound } from "@/lib/agentErrors";
import { track } from "@/lib/events";

export const runtime = "nodejs";

interface CreatePreviewBody {
  files?: { path: string; content: string }[];
}

// POST /api/agent/sites/{id}/previews — create_preview (preview:create).
// Unmetered, never touches the live sites pointer. If `files` are given they
// become the preview content; otherwise the site's current live files are
// snapshotted as-is (useful for "show me what's live right now, privately").
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isFlagEnabled("agent_gateway"))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const authRes = await requireAgentScope(req, "preview:create", { rateLimitKind: "write" });
  if ("error" in authRes) return authRes.error;
  const { id } = await params;

  const site = await agentOwnedSite(id, authRes.workspaceId);
  if (!site) return notFound();

  const body: CreatePreviewBody = await req.json().catch(() => ({}));
  const previewPrefix = `sites/${site.slug}-preview-${Date.now().toString(36)}/`;

  if (body.files && body.files.length > 0) {
    for (const f of body.files) {
      if (!/\.html?$/i.test(f.path)) return badRequest(`"${f.path}": only .html files are accepted`);
      await putObject(`${previewPrefix}${f.path}`, Buffer.from(f.content, "utf8"), "text/html; charset=utf-8");
    }
  } else {
    const existing = await listPrefix(site.s3_prefix);
    for (const file of existing) {
      const obj = await getObject(`${site.s3_prefix}${file.name}`);
      if (!obj) continue;
      await putObject(`${previewPrefix}${file.name}`, Buffer.from(obj.body), obj.contentType);
    }
  }

  const versionRows = await query<{ id: string }>(
    `INSERT INTO versions (site_id, number, storage_key, source, author_email, actor_type, summary)
     SELECT $1, COALESCE(MIN(number), 0) - 1, $2, 'agent', $3, 'agent', 'preview'
       FROM versions WHERE site_id = $1
     RETURNING id`,
    [site.id, previewPrefix, authRes.email],
  );

  const deployment = await createDeployment({
    siteId: site.id,
    versionId: versionRows[0].id,
    target: "preview",
    createdBy: authRes.email,
    actorType: "agent",
    agentClientId: authRes.agentClientId,
  });
  await transitionDeployment(deployment.id, "building");
  const ready = await transitionDeployment(deployment.id, "ready");

  await track("agent_action", {
    siteId: site.id,
    workspaceId: authRes.workspaceId,
    actor: authRes.email,
    actorType: "agent",
    meta: { tool: "create_preview", clientId: authRes.agentClientId, deploymentId: ready.id },
  });

  const base = requestBase(req);
  return NextResponse.json(
    {
      deploymentId: ready.id,
      previewUrl: `${base}/s/${site.slug}/preview/${ready.id}/`,
      status: ready.status,
    },
    { status: 201 },
  );
}
