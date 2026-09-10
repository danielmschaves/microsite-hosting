import { NextResponse } from "next/server";
import { requestBase } from "@/lib/url";
import { query } from "@/lib/db";
import { isFlagEnabled } from "@/lib/flags";
import { requireAgentScope } from "@/lib/agentAuthz";
import { agentOwnedSite } from "@/lib/agentSites";
import { changeVisibility, extendTtl } from "@/lib/siteMutations";
import { purgeSiteStorage } from "@/lib/createSite";
import { createConfirmToken, verifyConfirmToken } from "@/lib/agentConfirm";
import { notFound, badRequest } from "@/lib/agentErrors";
import { track } from "@/lib/events";

export const runtime = "nodejs";

// GET /api/agent/sites/{id} — get_site_context (site:read): framework
// (static HTML only in R0/R1), live URL, expiry, viewer list, version count.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isFlagEnabled("agent_gateway"))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const authRes = await requireAgentScope(req, "site:read", { rateLimitKind: "read" });
  if ("error" in authRes) return authRes.error;
  const { id } = await params;

  const site = await agentOwnedSite(id, authRes.workspaceId);
  if (!site) return notFound();

  const viewers = await query<{ viewer_email: string }>(
    "SELECT viewer_email FROM site_viewers WHERE site_id = $1",
    [site.id],
  );
  const versionCount = await query<{ count: string }>(
    "SELECT count(*) FROM versions WHERE site_id = $1",
    [site.id],
  );

  const base = requestBase(req);
  return NextResponse.json({
    id: site.id,
    slug: site.slug,
    previewUrl: `${base}/s/${site.slug}`,
    visibility: site.visibility,
    viewers: viewers.map((v) => v.viewer_email),
    ttl: site.ttl_preset,
    expiresAt: new Date(site.expires_at).toISOString(),
    currentVersion: site.current_version,
    versionCount: Number(versionCount[0]?.count ?? 0),
    pages: site.page_count,
    sizeBytes: Number(site.size_bytes),
    framework: "static-html",
  });
}

interface PatchBody {
  visibility?: string;
  viewers?: string[];
  ttl?: string;
}

// PATCH /api/agent/sites/{id} — set_site_visibility / set_site_expiry
// (site:write). Body discriminates like the session PATCH route.
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

  const body: PatchBody = await req.json().catch(() => ({}));
  const via = { via: "agent", clientId: authRes.agentClientId, actorType: "agent" as const };

  let result;
  if (typeof body.visibility === "string") {
    result = await changeVisibility(site, authRes.email, body.visibility, via);
    if (body.viewers && result.status === 200) {
      await query("DELETE FROM site_viewers WHERE site_id = $1", [site.id]);
      for (const viewer of body.viewers) {
        await query(
          "INSERT INTO site_viewers (site_id, viewer_email) VALUES ($1, $2) ON CONFLICT DO NOTHING",
          [site.id, viewer.toLowerCase()],
        );
      }
    }
  } else if (typeof body.ttl === "string") {
    result = await extendTtl(site, authRes.email, body.ttl, via);
  } else {
    return badRequest("Provide { visibility, viewers? } or { ttl }");
  }

  await track("agent_action", {
    siteId: site.id,
    workspaceId: authRes.workspaceId,
    actor: authRes.email,
    actorType: "agent",
    meta: { tool: typeof body.visibility === "string" ? "set_site_visibility" : "set_site_expiry", clientId: authRes.agentClientId },
  });

  return NextResponse.json(result.body, { status: result.status });
}

// DELETE /api/agent/sites/{id} — delete_site (site:delete), two-step
// confirmation. Step 1 (no confirmToken) returns a cascade summary +
// confirmToken; step 2 (?confirmToken=...) purges storage for good.
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isFlagEnabled("agent_gateway"))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const authRes = await requireAgentScope(req, "site:delete", { rateLimitKind: "write" });
  if ("error" in authRes) return authRes.error;
  const { id } = await params;

  const site = await agentOwnedSite(id, authRes.workspaceId);
  if (!site) return notFound();

  const confirmToken = new URL(req.url).searchParams.get("confirmToken");
  if (!confirmToken) {
    const versionCount = await query<{ count: string }>(
      "SELECT count(*) FROM site_versions WHERE site_id = $1",
      [site.id],
    );
    return NextResponse.json({
      confirmToken: createConfirmToken("delete_site", site.id, authRes.tokenId),
      summary: {
        slug: site.slug,
        versionsToDelete: Number(versionCount[0]?.count ?? 0),
        expiresIn: "5m",
      },
    });
  }

  const verified = verifyConfirmToken(confirmToken, "delete_site", site.id, authRes.tokenId);
  if (!verified.ok) {
    return NextResponse.json(
      { error: "invalid_confirm_token", message: verified.reason },
      { status: 400 },
    );
  }

  await purgeSiteStorage(site);
  await query(
    "UPDATE sites SET deleted_at = COALESCE(deleted_at, now()), purged_at = now() WHERE id = $1",
    [site.id],
  );
  await track("site_purged", {
    siteId: site.id,
    workspaceId: authRes.workspaceId,
    actor: authRes.email,
    actorType: "agent",
    meta: { via: "agent", clientId: authRes.agentClientId, tool: "delete_site" },
  });

  return NextResponse.json({ ok: true, purged: true });
}
