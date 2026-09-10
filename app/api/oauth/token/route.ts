import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { isFlagEnabled } from "@/lib/flags";
import { getOAuthRequest, isExpired, verifyPkce } from "@/lib/agentOAuth";
import { createAgentToken } from "@/lib/agentTokens";

export const runtime = "nodejs";

// POST /api/oauth/token — form-encoded, both grant types an MCP client uses:
//   grant_type=authorization_code&code=...&code_verifier=...
//   grant_type=urn:ietf:params:oauth:grant-type:device_code&device_code=...
// Mints the agent_tokens secret and returns it exactly once, same discipline
// as lib/apiTokens.ts's createToken.
export async function POST(req: Request) {
  if (!(await isFlagEnabled("agent_oauth"))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const params = new URLSearchParams(await req.text().catch(() => ""));
  const grantType = params.get("grant_type");

  if (grantType === "authorization_code") {
    const code = params.get("code");
    const codeVerifier = params.get("code_verifier");
    if (!code || !codeVerifier) {
      return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    }
    const rows = await query<{ id: string }>(
      "SELECT id FROM agent_oauth_requests WHERE auth_code = $1 AND flow = 'auth_code' AND status = 'authorized'",
      [code],
    );
    const oauthRequest = rows[0] ? await getOAuthRequest(rows[0].id) : null;
    if (!oauthRequest || isExpired(oauthRequest)) {
      return NextResponse.json({ error: "invalid_grant" }, { status: 400 });
    }
    if (!oauthRequest.code_challenge || !verifyPkce(codeVerifier, oauthRequest.code_challenge)) {
      return NextResponse.json({ error: "invalid_grant", message: "PKCE verification failed" }, { status: 400 });
    }
    return issueToken(oauthRequest.id, oauthRequest.workspace_id!, oauthRequest.agent_client_id!, oauthRequest.requested_scopes, oauthRequest.authorized_by!);
  }

  if (grantType === "urn:ietf:params:oauth:grant-type:device_code") {
    const deviceCode = params.get("device_code");
    if (!deviceCode) {
      return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    }
    const rows = await query<{ id: string }>(
      "SELECT id FROM agent_oauth_requests WHERE device_code = $1 AND flow = 'device_code'",
      [deviceCode],
    );
    const oauthRequest = rows[0] ? await getOAuthRequest(rows[0].id) : null;
    if (!oauthRequest) {
      return NextResponse.json({ error: "invalid_grant" }, { status: 400 });
    }
    if (isExpired(oauthRequest)) {
      return NextResponse.json({ error: "expired_token" }, { status: 400 });
    }
    if (oauthRequest.status === "pending") {
      return NextResponse.json({ error: "authorization_pending" }, { status: 400 });
    }
    if (oauthRequest.status === "denied") {
      return NextResponse.json({ error: "access_denied" }, { status: 400 });
    }
    if (oauthRequest.status !== "authorized") {
      return NextResponse.json({ error: "invalid_grant" }, { status: 400 });
    }
    return issueToken(oauthRequest.id, oauthRequest.workspace_id!, oauthRequest.agent_client_id!, oauthRequest.requested_scopes, oauthRequest.authorized_by!);
  }

  return NextResponse.json({ error: "unsupported_grant_type" }, { status: 400 });
}

async function issueToken(
  requestId: string,
  workspaceId: string,
  agentClientId: string,
  scopes: string[],
  grantedBy: string,
) {
  const { secret, token } = await createAgentToken({ workspaceId, agentClientId, scopes, grantedBy });
  await query(
    "UPDATE agent_oauth_requests SET status = 'consumed', issued_token_id = $1 WHERE id = $2",
    [token.id, requestId],
  );
  return NextResponse.json({
    access_token: secret,
    token_type: "bearer",
    expires_in: Math.floor((new Date(token.expires_at).getTime() - Date.now()) / 1000),
    scope: scopes.join(" "),
  });
}
