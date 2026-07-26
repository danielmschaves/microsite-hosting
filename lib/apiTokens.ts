import { createHash, randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { query, type ApiTokenRow } from "./db";
import { track } from "./events";

// Personal access tokens for the REST v1 API. Only the sha256 hash of a
// secret is ever stored; verification is a lookup by hash (the GitHub
// pattern — no stored-secret comparison, so timing attacks have nothing
// to measure). Tokens are full-account in v1; scopes are a future column.

const PREFIX = "mb_live_";

function hash(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export interface TokenView {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export function toTokenView(row: ApiTokenRow): TokenView {
  return {
    id: row.id,
    name: row.name,
    prefix: row.token_prefix,
    createdAt: new Date(row.created_at).toISOString(),
    lastUsedAt: row.last_used_at ? new Date(row.last_used_at).toISOString() : null,
  };
}

/** Create a token; the full secret exists only in this return value. */
export async function createToken(
  email: string,
  name: string,
): Promise<{ secret: string; token: TokenView }> {
  const secret = PREFIX + randomBytes(24).toString("base64url");
  const rows = await query<ApiTokenRow>(
    `INSERT INTO api_tokens (owner_email, name, token_hash, token_prefix)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [email.toLowerCase(), name, hash(secret), secret.slice(0, PREFIX.length + 4)],
  );
  await track("api_token_created", {
    actor: email,
    meta: { tokenId: rows[0].id, name },
  });
  return { secret, token: toTokenView(rows[0]) };
}

export async function listTokens(email: string): Promise<TokenView[]> {
  const rows = await query<ApiTokenRow>(
    `SELECT * FROM api_tokens
      WHERE owner_email = $1 AND revoked_at IS NULL
      ORDER BY created_at DESC`,
    [email.toLowerCase()],
  );
  return rows.map(toTokenView);
}

export async function revokeToken(id: string, email: string): Promise<boolean> {
  let rows: { id: string }[] = [];
  try {
    rows = await query<{ id: string }>(
      `UPDATE api_tokens SET revoked_at = now()
        WHERE id = $1 AND owner_email = $2 AND revoked_at IS NULL
        RETURNING id`,
      [id, email.toLowerCase()],
    );
  } catch {
    return false; // invalid uuid
  }
  if (rows.length === 0) return false;
  await track("api_token_revoked", { actor: email, meta: { tokenId: id } });
  return true;
}

/** Resolve a Bearer token to its owner, or null. Touches last_used_at. */
export async function verifyBearer(
  req: Request,
): Promise<{ email: string; tokenId: string } | null> {
  const header = req.headers.get("authorization") || "";
  if (!header.toLowerCase().startsWith("bearer ")) return null;
  const secret = header.slice(7).trim();
  if (!secret.startsWith(PREFIX)) return null;

  const rows = await query<ApiTokenRow>(
    "SELECT * FROM api_tokens WHERE token_hash = $1 AND revoked_at IS NULL",
    [hash(secret)],
  );
  const row = rows[0];
  if (!row) return null;
  await query("UPDATE api_tokens SET last_used_at = now() WHERE id = $1", [row.id]).catch(
    () => {},
  );
  return { email: row.owner_email, tokenId: row.id };
}

/** Route guard for /api/v1 handlers, mirroring requireWorkspaceRole's shape. */
export async function requireApiAuth(
  req: Request,
): Promise<{ email: string } | { error: NextResponse }> {
  const verified = await verifyBearer(req);
  if (!verified) {
    return {
      error: NextResponse.json(
        { error: "Provide a valid API token: Authorization: Bearer mb_live_…" },
        { status: 401 },
      ),
    };
  }
  return { email: verified.email };
}
