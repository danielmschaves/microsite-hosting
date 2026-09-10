import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { isFlagEnabled } from "@/lib/flags";
import { parseScopes, OAUTH_REQUEST_TTL_MS } from "@/lib/agentOAuth";
import type { AgentClientKind } from "@/lib/db";

export const runtime = "nodejs";

const VALID_KINDS: AgentClientKind[] = ["claude-code", "codex", "cursor", "other"];

// GET /api/oauth/authorize — the agent's browser-opened first step of the
// OAuth 2.1 auth-code+PKCE flow. Creates a pending agent_oauth_requests row
// and redirects to the human-facing consent screen. Query params:
//   client_name (required), client_kind, scopes (comma-separated, required),
//   code_challenge (required, S256), redirect_uri (required — loopback URI
//   the agent's local server is listening on), state (opaque, echoed back).
export async function GET(req: Request) {
  if (!(await isFlagEnabled("agent_oauth"))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const url = new URL(req.url);
  const clientName = url.searchParams.get("client_name")?.trim();
  const clientKindRaw = url.searchParams.get("client_kind")?.trim() || "other";
  const clientKind = VALID_KINDS.includes(clientKindRaw as AgentClientKind)
    ? (clientKindRaw as AgentClientKind)
    : "other";
  const codeChallenge = url.searchParams.get("code_challenge")?.trim();
  const codeChallengeMethod = url.searchParams.get("code_challenge_method")?.trim() || "S256";
  const redirectUri = url.searchParams.get("redirect_uri")?.trim();
  const state = url.searchParams.get("state")?.trim() || null;

  if (!clientName) {
    return NextResponse.json({ error: "invalid_request", message: "client_name is required" }, { status: 400 });
  }
  if (!codeChallenge || codeChallengeMethod !== "S256") {
    return NextResponse.json(
      { error: "invalid_request", message: "code_challenge (S256) is required" },
      { status: 400 },
    );
  }
  if (!redirectUri || !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(redirectUri)) {
    return NextResponse.json(
      { error: "invalid_request", message: "redirect_uri must be a loopback URL" },
      { status: 400 },
    );
  }
  const scopes = parseScopes(url.searchParams.get("scopes"));
  if ("error" in scopes) {
    return NextResponse.json({ error: "invalid_scope", message: scopes.error }, { status: 400 });
  }

  const expiresAt = new Date(Date.now() + OAUTH_REQUEST_TTL_MS);
  const rows = await query<{ id: string }>(
    `INSERT INTO agent_oauth_requests
       (flow, status, client_name, client_kind, requested_scopes, code_challenge,
        code_challenge_method, redirect_uri, state, expires_at)
     VALUES ('auth_code', 'pending', $1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [clientName, clientKind, scopes, codeChallenge, codeChallengeMethod, redirectUri, state, expiresAt],
  );

  const consentUrl = new URL("/oauth/consent", req.url);
  consentUrl.searchParams.set("requestId", rows[0].id);
  return NextResponse.redirect(consentUrl);
}
