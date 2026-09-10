import { createHash, randomBytes } from "crypto";
import {
  query,
  type AgentClientKind,
  type AgentClientRow,
  type AgentTokenRow,
} from "./db";
import { track } from "./events";

// Agent OAuth tokens (PRD v2.0 CD-06/CD-07). Mirrors lib/apiTokens.ts's
// sha256 hash-and-lookup pattern exactly ("the GitHub pattern — no
// stored-secret comparison, so timing attacks have nothing to measure") —
// only the prefix and the workspace/scope shape differ. Supersedes
// api_tokens for agent use only; api_tokens itself is untouched.

const PREFIX = "mb_agent_";
const TOKEN_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000; // 90-day max per the NFR table

function hash(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export interface AgentClientView {
  id: string;
  name: string;
  kind: AgentClientKind;
  firstSeenAt: string;
  lastSeenAt: string | null;
}

export function toAgentClientView(row: AgentClientRow): AgentClientView {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    firstSeenAt: new Date(row.first_seen_at).toISOString(),
    lastSeenAt: row.last_seen_at ? new Date(row.last_seen_at).toISOString() : null,
  };
}

export interface AgentTokenView {
  id: string;
  agentClientId: string;
  clientName: string;
  clientKind: AgentClientKind;
  prefix: string;
  scopes: string[];
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
}

/** Find or create the agent_clients row for a (workspace, name, kind) triple. */
export async function upsertAgentClient(
  workspaceId: string,
  name: string,
  kind: AgentClientKind,
): Promise<AgentClientRow> {
  const existing = await query<AgentClientRow>(
    "SELECT * FROM agent_clients WHERE workspace_id = $1 AND name = $2 AND kind = $3",
    [workspaceId, name, kind],
  );
  if (existing[0]) {
    await query("UPDATE agent_clients SET last_seen_at = now() WHERE id = $1", [
      existing[0].id,
    ]);
    return existing[0];
  }
  const inserted = await query<AgentClientRow>(
    `INSERT INTO agent_clients (workspace_id, name, kind, last_seen_at)
     VALUES ($1, $2, $3, now())
     RETURNING *`,
    [workspaceId, name, kind],
  );
  return inserted[0];
}

/** Mint an agent token; the full secret exists only in this return value. */
export async function createAgentToken(opts: {
  workspaceId: string;
  agentClientId: string;
  scopes: string[];
  grantedBy: string;
}): Promise<{ secret: string; token: AgentTokenRow }> {
  const secret = PREFIX + randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + TOKEN_LIFETIME_MS);
  const rows = await query<AgentTokenRow>(
    `INSERT INTO agent_tokens (workspace_id, agent_client_id, token_hash, token_prefix, scopes, granted_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      opts.workspaceId,
      opts.agentClientId,
      hash(secret),
      secret.slice(0, PREFIX.length + 4),
      opts.scopes,
      opts.grantedBy.toLowerCase(),
      expiresAt,
    ],
  );
  await track("agent_token_created", {
    workspaceId: opts.workspaceId,
    actor: opts.grantedBy,
    actorType: "human",
    meta: { tokenId: rows[0].id, agentClientId: opts.agentClientId, scopes: opts.scopes },
  });
  return { secret, token: rows[0] };
}

export async function listAgentClients(workspaceId: string): Promise<AgentClientView[]> {
  const rows = await query<AgentClientRow>(
    "SELECT * FROM agent_clients WHERE workspace_id = $1 ORDER BY first_seen_at DESC",
    [workspaceId],
  );
  return rows.map(toAgentClientView);
}

export async function listAgentTokens(workspaceId: string): Promise<AgentTokenView[]> {
  const rows = await query<AgentTokenRow & { client_name: string; client_kind: AgentClientKind }>(
    `SELECT t.*, c.name AS client_name, c.kind AS client_kind
       FROM agent_tokens t
       JOIN agent_clients c ON c.id = t.agent_client_id
      WHERE t.workspace_id = $1 AND t.revoked_at IS NULL
      ORDER BY t.created_at DESC`,
    [workspaceId],
  );
  return rows.map((r) => ({
    id: r.id,
    agentClientId: r.agent_client_id,
    clientName: r.client_name,
    clientKind: r.client_kind,
    prefix: r.token_prefix,
    scopes: r.scopes,
    createdAt: new Date(r.created_at).toISOString(),
    expiresAt: new Date(r.expires_at).toISOString(),
    lastUsedAt: r.last_used_at ? new Date(r.last_used_at).toISOString() : null,
  }));
}

/** Revoke a token; scoped to the workspace so one workspace can't touch another's tokens. */
export async function revokeAgentToken(id: string, workspaceId: string): Promise<boolean> {
  let rows: { id: string }[] = [];
  try {
    rows = await query<{ id: string }>(
      `UPDATE agent_tokens SET revoked_at = now()
        WHERE id = $1 AND workspace_id = $2 AND revoked_at IS NULL
        RETURNING id`,
      [id, workspaceId],
    );
  } catch {
    return false; // invalid uuid
  }
  if (rows.length === 0) return false;
  await track("agent_token_revoked", {
    workspaceId,
    actorType: "human",
    meta: { tokenId: id },
  });
  return true;
}

export { hash as hashAgentSecret, PREFIX as AGENT_TOKEN_PREFIX };
