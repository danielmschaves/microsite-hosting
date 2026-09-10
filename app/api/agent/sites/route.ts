import { NextResponse } from "next/server";
import { requestBase } from "@/lib/url";
import { query } from "@/lib/db";
import { isFlagEnabled } from "@/lib/flags";
import { requireAgentScope } from "@/lib/agentAuthz";
import { performServerUpload } from "@/lib/uploadService";
import { badRequest } from "@/lib/agentErrors";
import { track } from "@/lib/events";

export const runtime = "nodejs";

// GET /api/agent/sites — list_sites (site:read). Workspace-scoped, unlike
// the v1 API's owner-email scoping (see lib/agentSites.ts).
export async function GET(req: Request) {
  if (!(await isFlagEnabled("agent_gateway"))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const authRes = await requireAgentScope(req, "site:read", { rateLimitKind: "read" });
  if ("error" in authRes) return authRes.error;

  const rows = await query<{
    id: string;
    slug: string;
    size_bytes: string;
    page_count: number;
    ttl_preset: string;
    visibility: string;
    current_version: number;
    expires_at: Date;
    created_at: Date;
  }>(
    `SELECT id, slug, size_bytes, page_count, ttl_preset, visibility, current_version,
            expires_at, created_at
       FROM sites
      WHERE workspace_id = $1 AND deleted_at IS NULL
      ORDER BY created_at DESC`,
    [authRes.workspaceId],
  );
  const base = requestBase(req);
  return NextResponse.json({
    sites: rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      url: `${base}/s/${r.slug}`,
      sizeBytes: Number(r.size_bytes),
      pages: Number(r.page_count),
      ttl: r.ttl_preset,
      visibility: r.visibility,
      version: Number(r.current_version),
      expiresAt: new Date(r.expires_at).toISOString(),
      createdAt: new Date(r.created_at).toISOString(),
    })),
  });
}

interface CreateSiteBody {
  slug?: string;
  files?: { path: string; content: string }[];
  index?: string;
  ttl?: string;
  visibility?: string;
  viewers?: string[];
}

// POST /api/agent/sites — create_site_from_html (site:write + preview:create).
// The wedge: visibility and ttl are required arguments, not optional. Reuses
// performServerUpload() unchanged — the only difference from the human
// upload path is identity resolution (agent token -> workspace) and that
// files arrive as inline {path, content} JSON instead of multipart.
export async function POST(req: Request) {
  if (!(await isFlagEnabled("agent_gateway"))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const authRes = await requireAgentScope(req, "site:write", { rateLimitKind: "write" });
  if ("error" in authRes) return authRes.error;

  const body: CreateSiteBody = await req.json().catch(() => ({}));
  if (!body.files || body.files.length === 0) {
    return badRequest("Provide files: [{ path, content }]");
  }
  if (!body.visibility) {
    return badRequest("visibility is required (only_me, allowlist, team or public) — see PRD §9.3");
  }
  if (!body.ttl) {
    return badRequest("ttl is required (24h, 7d, 30d or 90d) — see PRD §9.3");
  }

  const rawFiles = body.files.map(
    (f) => new File([f.content], f.path, { type: "text/html" }),
  );

  const result = await performServerUpload({
    email: authRes.email,
    rawFiles,
    ttl: body.ttl,
    requestedSlug: body.slug || "",
    requestedIndex: body.index || "",
    viewersRaw: (body.viewers || []).join(","),
    workspaceId: authRes.workspaceId,
    visibilityRaw: body.visibility,
  });
  if ("error" in result) return result.error;

  await track("agent_action", {
    siteId: result.site.id,
    workspaceId: authRes.workspaceId,
    actor: authRes.email,
    actorType: "agent",
    meta: { tool: "create_site_from_html", clientId: authRes.agentClientId },
  });

  const base = requestBase(req);
  return NextResponse.json(
    {
      siteId: result.site.id,
      slug: result.site.slug,
      previewUrl: `${base}/s/${result.site.slug}`,
      visibility: result.site.visibility,
      expiresAt: new Date(result.site.expires_at).toISOString(),
      pages: result.pages,
      version: result.version,
    },
    { status: result.republished ? 200 : 201 },
  );
}
