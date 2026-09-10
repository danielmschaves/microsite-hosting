import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { query, type AgentClientKind } from "@/lib/db";
import { getMembership } from "@/lib/teams";
import { isFlagEnabled } from "@/lib/flags";
import { getOAuthRequest, isExpired, generateOpaqueToken } from "@/lib/agentOAuth";
import { upsertAgentClient } from "@/lib/agentTokens";
import { track } from "@/lib/events";

export const runtime = "nodejs";

// POST /api/oauth/consent — { requestId, workspaceId, decision: "allow"|"deny" }
// Session-gated: the human approving the grant must be signed in and a
// member of the workspace they're granting access to. Does not mint a token
// here — that happens at the /token exchange (auth_code) or the next device
// poll (device_code), standard OAuth separation of "authorize" from "issue".
export async function POST(req: Request) {
  if (!(await isFlagEnabled("agent_oauth"))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const requestId = String(body?.requestId || "");
  const workspaceId = String(body?.workspaceId || "");
  const decision = body?.decision === "allow" ? "allow" : body?.decision === "deny" ? "deny" : null;
  if (!requestId || !decision) {
    return NextResponse.json({ error: "invalid_request", message: "Provide requestId and decision" }, { status: 400 });
  }

  const oauthRequest = await getOAuthRequest(requestId);
  if (!oauthRequest || oauthRequest.status !== "pending" || isExpired(oauthRequest)) {
    return NextResponse.json({ error: "invalid_request", message: "This request is no longer pending" }, { status: 404 });
  }

  if (decision === "deny") {
    await query("UPDATE agent_oauth_requests SET status = 'denied' WHERE id = $1", [requestId]);
    return NextResponse.json({ ok: true, decision: "denied" });
  }

  if (!workspaceId) {
    return NextResponse.json({ error: "invalid_request", message: "Choose a workspace" }, { status: 400 });
  }
  const role = await getMembership(email, workspaceId);
  if (!role) {
    return NextResponse.json({ error: "forbidden", message: "You are not a member of that workspace" }, { status: 403 });
  }

  const VALID_KINDS: AgentClientKind[] = ["claude-code", "codex", "cursor", "other"];
  const clientKind: AgentClientKind = VALID_KINDS.includes(oauthRequest.client_kind as AgentClientKind)
    ? (oauthRequest.client_kind as AgentClientKind)
    : "other";
  const client = await upsertAgentClient(workspaceId, oauthRequest.client_name, clientKind);

  if (oauthRequest.flow === "auth_code") {
    const authCode = generateOpaqueToken(24);
    await query(
      `UPDATE agent_oauth_requests
          SET status = 'authorized', workspace_id = $1, agent_client_id = $2,
              authorized_by = $3, auth_code = $4
        WHERE id = $5`,
      [workspaceId, client.id, email, authCode, requestId],
    );
    await track("agent_client_authorized", {
      workspaceId,
      actor: email,
      meta: { clientId: client.id, clientName: client.name, scopes: oauthRequest.requested_scopes },
    });

    const redirectTo = new URL(oauthRequest.redirect_uri!);
    redirectTo.searchParams.set("code", authCode);
    if (oauthRequest.state) redirectTo.searchParams.set("state", oauthRequest.state);
    return NextResponse.json({ ok: true, decision: "allowed", redirectTo: redirectTo.toString() });
  }

  // device_code flow: no redirect target — the CLI is polling /api/oauth/token.
  await query(
    `UPDATE agent_oauth_requests
        SET status = 'authorized', workspace_id = $1, agent_client_id = $2, authorized_by = $3
      WHERE id = $4`,
    [workspaceId, client.id, email, requestId],
  );
  await track("agent_client_authorized", {
    workspaceId,
    actor: email,
    meta: { clientId: client.id, clientName: client.name, scopes: oauthRequest.requested_scopes },
  });
  return NextResponse.json({ ok: true, decision: "allowed" });
}
