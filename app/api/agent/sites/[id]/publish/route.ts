import { NextResponse } from "next/server";
import { requestBase } from "@/lib/url";
import { query, type DeploymentRow, type VersionRow, type WorkspaceRow, type PublishMode } from "@/lib/db";
import { isFlagEnabled } from "@/lib/flags";
import { requireAgentScope } from "@/lib/agentAuthz";
import { agentOwnedSite } from "@/lib/agentSites";
import { listPrefix } from "@/lib/storage";
import { resolveIndex, publishSiteVersion } from "@/lib/createSite";
import { planForWorkspace } from "@/lib/plan";
import { isTtlPreset } from "@/lib/ttl";
import { createConfirmToken, verifyConfirmToken } from "@/lib/agentConfirm";
import { withIdempotency } from "@/lib/idempotency";
import { badRequest, notFound } from "@/lib/agentErrors";
import { track } from "@/lib/events";

export const runtime = "nodejs";

// CD-16 NFR: publish_site's confirm token lives 10 minutes, not the default 5.
const PUBLISH_CONFIRM_TTL_MS = 10 * 60 * 1000;

interface PublishBody {
  deploymentId?: string;
  ttl?: string;
  confirmToken?: string;
}

// POST /api/agent/sites/{id}/publish — publish_site (publish:confirm).
// Gated by the workspace's publish_mode (CD-16):
//   - "direct": no confirmation step, executes on the first call.
//   - "confirm": two-step HMAC confirm token (10-minute TTL), the default.
//   - "approval": always rejected here — agents cannot self-approve
//     regardless of scope; only request_publish (a separate publish:request
//     scope) can start a review, and only a human deciding on
//     POST /api/approvals/{id} can actually execute the publish.
// Step 1 (no confirmToken, confirm mode) returns {confirmToken, summary},
// including a soft `warning` when publishing without having gone through
// create_preview first (packages/skill/SKILL.md's guardrail is soft by
// design — see CLAUDE.md — because rollback_to_version explicitly publishes
// without a preview too, so a hard block here would be inconsistent). The
// execute step always requires a mandatory Idempotency-Key header per the
// NFR table, regardless of publish_mode.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isFlagEnabled("agent_gateway"))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const authRes = await requireAgentScope(req, "publish:confirm", { rateLimitKind: "write" });
  if ("error" in authRes) return authRes.error;
  const { id } = await params;

  const site = await agentOwnedSite(id, authRes.workspaceId);
  if (!site) return notFound();

  const workspaceRows = site.workspace_id
    ? await query<WorkspaceRow>("SELECT * FROM workspaces WHERE id = $1", [site.workspace_id])
    : [];
  const workspace = workspaceRows[0] ?? null;
  const mode: PublishMode = workspace?.publish_mode ?? "confirm";

  if (mode === "approval") {
    return NextResponse.json(
      {
        error: "approval_required",
        message:
          "This workspace requires human approval to publish. Call request_publish to start a review.",
        publishMode: "approval",
      },
      { status: 400 },
    );
  }

  const bodyText = await req.text();
  const body: PublishBody = bodyText ? JSON.parse(bodyText) : {};

  let previewDeployment: DeploymentRow | null = null;
  if (body.deploymentId) {
    const rows = await query<DeploymentRow>(
      `SELECT * FROM deployments
        WHERE id = $1 AND site_id = $2 AND target = 'preview' AND status = 'ready'`,
      [body.deploymentId, site.id],
    );
    previewDeployment = rows[0] ?? null;
    if (!previewDeployment) {
      return badRequest("deploymentId does not name a ready preview for this site");
    }
  }

  if (mode === "confirm" && !body.confirmToken) {
    const hasReadyPreview = Boolean(previewDeployment);
    return NextResponse.json({
      confirmToken: createConfirmToken("publish_site", site.id, authRes.tokenId, PUBLISH_CONFIRM_TTL_MS),
      summary: {
        slug: site.slug,
        promoting: previewDeployment ? previewDeployment.id : "current content",
        currentVisibility: site.visibility,
      },
      ...(hasReadyPreview
        ? {}
        : {
            warning:
              "No ready preview was named. Consider calling create_preview first so you (and reviewers) can see the result before it goes live.",
          }),
    });
  }

  if (mode === "confirm") {
    const verified = verifyConfirmToken(body.confirmToken!, "publish_site", site.id, authRes.tokenId);
    if (!verified.ok) {
      return NextResponse.json(
        { error: "invalid_confirm_token", message: verified.reason },
        { status: 400 },
      );
    }
  }

  const idempotencyKey = req.headers.get("idempotency-key");
  if (!idempotencyKey) {
    return badRequest("Idempotency-Key header is required for publish_site");
  }

  const result = await withIdempotency(
    { key: idempotencyKey, tokenId: authRes.tokenId, method: "POST", url: req.url, bodyText },
    async () => {
      let s3Prefix: string;
      let indexName: string;
      let totalBytes: number;
      let pageCount: number;

      if (previewDeployment) {
        const versionRows = await query<VersionRow>("SELECT * FROM versions WHERE id = $1", [
          previewDeployment.version_id,
        ]);
        const version = versionRows[0];
        if (!version) return { status: 404, body: { error: "not_found", message: "Preview content missing" } };
        const files = await listPrefix(version.storage_key);
        const idx = resolveIndex(files.map((f) => f.name), "");
        if ("error" in idx) return { status: 400, body: { error: "invalid_request", message: idx.error } };
        s3Prefix = version.storage_key;
        indexName = idx.indexName;
        totalBytes = files.reduce((sum, f) => sum + f.size, 0);
        pageCount = files.length;
      } else {
        s3Prefix = site.s3_prefix;
        indexName = site.index_key.slice(site.s3_prefix.length);
        totalBytes = site.size_bytes;
        pageCount = site.page_count;
      }

      const ttlRaw = body.ttl || site.ttl_preset;
      if (!isTtlPreset(ttlRaw)) {
        return { status: 400, body: { error: "invalid_request", message: "ttl must be 24h, 7d, 30d or 90d" } };
      }

      const plan = planForWorkspace(workspace);

      const published = await publishSiteVersion({
        site,
        email: authRes.email,
        s3Prefix,
        indexName,
        totalBytes,
        pageCount,
        ttl: ttlRaw,
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
        meta: { tool: "publish_site", clientId: authRes.agentClientId, version: published.version },
      });

      const base = requestBase(req);
      return {
        status: 200,
        body: {
          ok: true,
          version: published.version,
          deploymentId: published.deployment?.id ?? null,
          url: `${base}/s/${published.site.slug}`,
          expiresAt: new Date(published.site.expires_at).toISOString(),
        },
      };
    },
  );

  return NextResponse.json(result.body, { status: result.status });
}
