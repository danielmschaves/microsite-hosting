import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  query,
  type ApprovalRow,
  type SiteRow,
  type WorkspaceRow,
  type DeploymentRow,
  type VersionRow,
} from "@/lib/db";
import { getMembership, roleAtLeast } from "@/lib/teams";
import { resolveIndex, publishSiteVersion } from "@/lib/createSite";
import { rollbackToVersion } from "@/lib/siteMutations";
import { listPrefix } from "@/lib/storage";
import { planForWorkspace } from "@/lib/plan";
import { isTtlPreset } from "@/lib/ttl";
import { track } from "@/lib/events";

export const runtime = "nodejs";

interface DecisionBody {
  decision?: "approve" | "reject";
  note?: string;
}

// POST /api/approvals/{id} — session-authenticated only. Never imports
// requireAgentScope: that omission IS the enforcement mechanism for "agents
// cannot self-approve" — there is structurally no Bearer-token path to this
// route, regardless of what scopes a token carries.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  let rows: ApprovalRow[] = [];
  try {
    rows = await query<ApprovalRow>("SELECT * FROM approvals WHERE id = $1", [id]);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const approval = rows[0];
  if (!approval) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const role = await getMembership(email, approval.workspace_id);
  if (!role || !roleAtLeast(role, "admin")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (approval.status !== "pending") {
    return NextResponse.json(
      { error: "already_decided", status: approval.status },
      { status: 409 },
    );
  }
  if (new Date(approval.expires_at).getTime() <= Date.now()) {
    await query(
      "UPDATE approvals SET status = 'expired' WHERE id = $1 AND status = 'pending'",
      [approval.id],
    );
    return NextResponse.json({ error: "expired" }, { status: 409 });
  }

  const body: DecisionBody = await req.json().catch(() => ({}));
  if (body.decision !== "approve" && body.decision !== "reject") {
    return NextResponse.json({ error: "Provide decision: approve or reject" }, { status: 400 });
  }

  if (body.decision === "reject") {
    await query(
      `UPDATE approvals
          SET status = 'rejected', decided_by = $1, decided_at = now(), decision_note = $2
        WHERE id = $3`,
      [email, body.note ?? null, approval.id],
    );
    await track("approval_decided", {
      siteId: approval.site_id,
      workspaceId: approval.workspace_id,
      actor: email,
      meta: { approvalId: approval.id, action: approval.action, decision: "reject" },
    });
    return NextResponse.json({ ok: true, status: "rejected" });
  }

  // Approve: re-check the site still exists, then execute the underlying
  // mutation attributed to requested_by (the agent's human), never to the
  // approver — the approver authorized it, the requester is still the actor
  // of record, matching every other agent-attributed mutation in this app.
  const siteRows = await query<SiteRow>(
    "SELECT * FROM sites WHERE id = $1 AND deleted_at IS NULL AND purged_at IS NULL",
    [approval.site_id],
  );
  const site = siteRows[0];
  if (!site) {
    return NextResponse.json({ error: "Site no longer exists" }, { status: 404 });
  }

  let resultingVersion: number;

  if (approval.action === "rollback") {
    const result = await rollbackToVersion(site, approval.requested_by, approval.target_version!, {
      via: "approval",
      approvalId: approval.id,
      decidedBy: email,
      actorType: "agent",
      clientId: approval.agent_client_id ?? undefined,
    });
    if (result.status !== 200) {
      return NextResponse.json({ error: "execution_failed", detail: result.body }, { status: 500 });
    }
    resultingVersion = Number((result.body as { version: number }).version);
  } else {
    let s3Prefix: string;
    let indexName: string;
    let totalBytes: number;
    let pageCount: number;

    if (approval.deployment_id) {
      const deploymentRows = await query<DeploymentRow>(
        "SELECT * FROM deployments WHERE id = $1",
        [approval.deployment_id],
      );
      const deployment = deploymentRows[0];
      if (!deployment || deployment.status !== "ready" || deployment.target !== "preview") {
        return NextResponse.json({ error: "Preview is no longer ready" }, { status: 409 });
      }
      const versionRows = await query<VersionRow>("SELECT * FROM versions WHERE id = $1", [
        deployment.version_id,
      ]);
      const version = versionRows[0];
      if (!version) {
        return NextResponse.json({ error: "Preview content missing" }, { status: 404 });
      }
      const files = await listPrefix(version.storage_key);
      const idx = resolveIndex(files.map((f) => f.name), "");
      if ("error" in idx) {
        return NextResponse.json({ error: idx.error }, { status: 400 });
      }
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

    const ttlRaw = approval.ttl_override || site.ttl_preset;
    if (!isTtlPreset(ttlRaw)) {
      return NextResponse.json({ error: "Stored ttl_override is invalid" }, { status: 400 });
    }

    const workspaceRows = site.workspace_id
      ? await query<WorkspaceRow>("SELECT * FROM workspaces WHERE id = $1", [site.workspace_id])
      : [];
    const plan = planForWorkspace(workspaceRows[0] ?? null);

    const published = await publishSiteVersion({
      site,
      email: approval.requested_by,
      s3Prefix,
      indexName,
      totalBytes,
      pageCount,
      ttl: ttlRaw,
      versionLimit: plan.versionLimit,
      actorType: "agent",
      agentClientId: approval.agent_client_id,
      source: "agent",
    });
    resultingVersion = published.version;
  }

  await query(
    `UPDATE approvals
        SET status = 'approved', decided_by = $1, decided_at = now(),
            decision_note = $2, resulting_version = $3
      WHERE id = $4`,
    [email, body.note ?? null, resultingVersion, approval.id],
  );

  await track("approval_decided", {
    siteId: approval.site_id,
    workspaceId: approval.workspace_id,
    actor: email,
    meta: { approvalId: approval.id, action: approval.action, decision: "approve", resultingVersion },
  });

  return NextResponse.json({ ok: true, status: "approved", resultingVersion });
}
