import { NextResponse } from "next/server";
import { isFlagEnabled } from "@/lib/flags";
import { requireAgentScope } from "@/lib/agentAuthz";
import { agentOwnedSite } from "@/lib/agentSites";
import { listPrefix, getObject, putObject } from "@/lib/storage";
import { publishSiteVersion } from "@/lib/createSite";
import { planForWorkspace } from "@/lib/plan";
import { isTtlPreset } from "@/lib/ttl";
import { query, type WorkspaceRow } from "@/lib/db";
import { badRequest, notFound } from "@/lib/agentErrors";
import { track } from "@/lib/events";

export const runtime = "nodejs";

interface PatchFilesBody {
  files?: { path: string; content: string }[];
}

// PATCH /api/agent/sites/{id}/files — apply_site_patch (site:write). Merges
// the given files onto the site's current file set (add/replace by path,
// existing files not named are kept) and publishes the result as a new
// version through the existing publishSiteVersion — no new versioning
// machinery, just a different way of assembling the file set that feeds it.
export async function PATCH(
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

  const body: PatchFilesBody = await req.json().catch(() => ({}));
  if (!body.files || body.files.length === 0) {
    return badRequest("Provide files: [{ path, content }]");
  }

  const existingFiles = await listPrefix(site.s3_prefix);
  const patchedNames = new Set(body.files.map((f) => f.path));
  const newPrefix = `${site.s3_prefix.replace(/\/$/, "")}-patch-${Date.now().toString(36)}/`;

  let totalBytes = 0;
  let pageCount = 0;
  for (const existing of existingFiles) {
    if (patchedNames.has(existing.name)) continue;
    const obj = await getObject(`${site.s3_prefix}${existing.name}`);
    if (!obj) continue;
    await putObject(`${newPrefix}${existing.name}`, Buffer.from(obj.body), obj.contentType);
    totalBytes += obj.body.length;
    pageCount++;
  }
  for (const f of body.files) {
    const buffer = Buffer.from(f.content, "utf8");
    await putObject(`${newPrefix}${f.path}`, buffer, "text/html; charset=utf-8");
    totalBytes += buffer.length;
    pageCount++;
  }

  const workspaceRows = site.workspace_id
    ? await query<WorkspaceRow>("SELECT * FROM workspaces WHERE id = $1", [site.workspace_id])
    : [];
  const plan = planForWorkspace(workspaceRows[0] ?? null);

  const indexName = site.index_key.slice(site.s3_prefix.length);
  if (!isTtlPreset(site.ttl_preset)) {
    return badRequest("Site has an invalid stored ttl_preset");
  }

  const published = await publishSiteVersion({
    site,
    email: authRes.email,
    s3Prefix: newPrefix,
    indexName,
    totalBytes,
    pageCount,
    ttl: site.ttl_preset,
    versionLimit: plan.versionLimit,
    actorType: "agent",
    agentClientId: authRes.agentClientId,
    source: "agent",
  });

  await track("agent_action", {
    siteId: site.id,
    workspaceId: authRes.workspaceId,
    actor: authRes.email,
    actorType: "agent",
    meta: { tool: "apply_site_patch", clientId: authRes.agentClientId, filesChanged: body.files.length },
  });

  return NextResponse.json({
    ok: true,
    version: published.version,
    pages: pageCount,
  });
}
