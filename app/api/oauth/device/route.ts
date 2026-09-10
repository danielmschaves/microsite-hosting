import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requestBase } from "@/lib/url";
import { isFlagEnabled } from "@/lib/flags";
import {
  parseScopes,
  generateOpaqueToken,
  generateUserCode,
  OAUTH_REQUEST_TTL_MS,
  DEVICE_POLL_INTERVAL_SECONDS,
} from "@/lib/agentOAuth";
import type { AgentClientKind } from "@/lib/db";

export const runtime = "nodejs";

const VALID_KINDS: AgentClientKind[] = ["claude-code", "codex", "cursor", "other"];

// POST /api/oauth/device — device-code bootstrap for headless agents (no
// loopback browser redirect available, e.g. a remote/CI MCP server). Body:
// { client_name, client_kind?, scopes } (JSON or form-encoded).
export async function POST(req: Request) {
  if (!(await isFlagEnabled("agent_oauth"))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const contentType = req.headers.get("content-type") || "";
  let params: URLSearchParams;
  if (contentType.includes("application/json")) {
    const body = await req.json().catch(() => ({}));
    params = new URLSearchParams();
    if (body.client_name) params.set("client_name", String(body.client_name));
    if (body.client_kind) params.set("client_kind", String(body.client_kind));
    if (body.scopes) params.set("scopes", String(body.scopes));
  } else {
    params = new URLSearchParams(await req.text().catch(() => ""));
  }

  const clientName = params.get("client_name")?.trim();
  const clientKindRaw = params.get("client_kind")?.trim() || "other";
  const clientKind = VALID_KINDS.includes(clientKindRaw as AgentClientKind)
    ? (clientKindRaw as AgentClientKind)
    : "other";
  if (!clientName) {
    return NextResponse.json({ error: "invalid_request", message: "client_name is required" }, { status: 400 });
  }
  const scopes = parseScopes(params.get("scopes"));
  if ("error" in scopes) {
    return NextResponse.json({ error: "invalid_scope", message: scopes.error }, { status: 400 });
  }

  const deviceCode = generateOpaqueToken(32);
  const userCode = generateUserCode();
  const expiresAt = new Date(Date.now() + OAUTH_REQUEST_TTL_MS);

  await query(
    `INSERT INTO agent_oauth_requests
       (flow, status, client_name, client_kind, requested_scopes, device_code, user_code, expires_at)
     VALUES ('device_code', 'pending', $1, $2, $3, $4, $5, $6)`,
    [clientName, clientKind, scopes, deviceCode, userCode, expiresAt],
  );

  const base = requestBase(req);
  const verificationUri = `${base}/oauth/device`;
  return NextResponse.json({
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: verificationUri,
    verification_uri_complete: `${verificationUri}?user_code=${encodeURIComponent(userCode)}`,
    expires_in: Math.floor(OAUTH_REQUEST_TTL_MS / 1000),
    interval: DEVICE_POLL_INTERVAL_SECONDS,
  });
}
