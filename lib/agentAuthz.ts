import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { query, type AgentTokenRow } from "./db";
import { checkRateLimit } from "./rateLimit";
import { AGENT_TOKEN_PREFIX } from "./agentTokens";

// ---------------------------------------------------------------------------
// Agent scope model (PRD v2.0 CD-06). Parallel to lib/authz.ts/lib/teams.ts
// rather than a refactor of them — this codebase's established convention is
// one function per auth mechanism (authorizeSiteManage for sessions,
// requireApiAuth for api_tokens, and now this for agent_tokens), not a
// unified wrapper. canViewSite (lib/authz.ts) stays reusable as-is by
// read-scoped tools since it's already session-agnostic.
// ---------------------------------------------------------------------------

export type AgentScope =
  | "project:read"
  | "site:read"
  | "site:write"
  | "site:delete"
  | "preview:create"
  | "preview:read"
  | "publish:request"
  | "publish:confirm"
  | "rollback:confirm"
  | "checks:run"
  | "logs:read"
  | "template:read"
  | "template:create"
  | "insights:read";

export const ALL_SCOPES: AgentScope[] = [
  "project:read",
  "site:read",
  "site:write",
  "site:delete",
  "preview:create",
  "preview:read",
  "publish:request",
  "publish:confirm",
  "rollback:confirm",
  "checks:run",
  "logs:read",
  "template:read",
  "template:create",
  "insights:read",
];

// The 14 R1 tools only exercise these 8 — the rest existed in the type/DB
// from R0 (cheap, matches "mirrors Showly's model") but had no route
// enforcing them until R2 shipped the tools that use them. R2 additionally
// enforces "publish:request" (request_publish, get_approval_status). Kept
// as a historical R1 marker rather than renamed/expanded — new scopes get
// enforced by the routes that check them directly, not by growing this list.
export const R1_ENFORCED_SCOPES: AgentScope[] = [
  "project:read",
  "site:read",
  "site:write",
  "site:delete",
  "preview:create",
  "preview:read",
  "publish:confirm",
  "rollback:confirm",
];

export function isAgentScope(value: string): value is AgentScope {
  return (ALL_SCOPES as string[]).includes(value);
}

function hash(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export interface VerifiedAgentToken {
  email: string;
  workspaceId: string;
  agentClientId: string;
  tokenId: string;
  scopes: AgentScope[];
}

/** Resolve a Bearer token to its workspace/client/scopes, or null. */
export async function verifyAgentBearer(req: Request): Promise<VerifiedAgentToken | null> {
  const header = req.headers.get("authorization") || "";
  if (!header.toLowerCase().startsWith("bearer ")) return null;
  const secret = header.slice(7).trim();
  if (!secret.startsWith(AGENT_TOKEN_PREFIX)) return null;

  const rows = await query<AgentTokenRow>(
    `SELECT * FROM agent_tokens
      WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
    [hash(secret)],
  );
  const row = rows[0];
  if (!row) return null;

  return {
    email: row.granted_by,
    workspaceId: row.workspace_id,
    agentClientId: row.agent_client_id,
    tokenId: row.id,
    scopes: row.scopes.filter(isAgentScope),
  };
}

export interface AgentAuthContext {
  email: string;
  workspaceId: string;
  agentClientId: string;
  tokenId: string;
}

/**
 * Route/tool guard: verify the bearer token, require `scope`, and enforce
 * the per-token rate-limit bucket matching the request's kind — the single
 * enforcement point CD-06 requires ("never inline in a route"). Every
 * app/api/agent/** handler calls this as its first line, mirroring
 * requireApiAuth's existing idiom (lib/apiTokens.ts).
 */
export async function requireAgentScope(
  req: Request,
  scope: AgentScope,
  opts: { rateLimitKind?: "read" | "write" | "publish" } = {},
): Promise<AgentAuthContext | { error: NextResponse }> {
  const verified = await verifyAgentBearer(req);
  if (!verified) {
    return {
      error: NextResponse.json(
        {
          error: "unauthorized",
          message: `Provide a valid agent token: Authorization: Bearer ${AGENT_TOKEN_PREFIX}…`,
        },
        { status: 401 },
      ),
    };
  }
  if (!verified.scopes.includes(scope)) {
    return {
      error: NextResponse.json(
        {
          error: "insufficient_scope",
          scope,
          message: `This token is missing the "${scope}" scope.`,
        },
        { status: 403 },
      ),
    };
  }

  const kind = opts.rateLimitKind ?? (scope.endsWith(":read") ? "read" : "write");
  const limits: Record<"read" | "write" | "publish", { limit: number; windowSeconds: number }> = {
    read: { limit: 120, windowSeconds: 60 },
    write: { limit: 20, windowSeconds: 60 },
    publish: { limit: 5, windowSeconds: 60 },
  };
  const { limit, windowSeconds } = limits[kind];
  const rl = await checkRateLimit(`token:${verified.tokenId}:${kind}`, limit, windowSeconds);
  if (!rl.ok) {
    return {
      error: NextResponse.json(
        {
          error: "rate_limited",
          message: `Rate limit exceeded (${limit} ${kind} requests/min). Retry after ${rl.retryAfterSeconds}s.`,
          retryAfter: rl.retryAfterSeconds,
        },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
      ),
    };
  }

  await query("UPDATE agent_tokens SET last_used_at = now() WHERE id = $1", [
    verified.tokenId,
  ]).catch(() => {});

  return {
    email: verified.email,
    workspaceId: verified.workspaceId,
    agentClientId: verified.agentClientId,
    tokenId: verified.tokenId,
  };
}
