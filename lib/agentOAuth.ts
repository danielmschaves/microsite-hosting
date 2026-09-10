import { createHash, randomBytes } from "crypto";
import { query, type AgentOAuthRequestRow } from "./db";
import type { AgentScope } from "./agentAuthz";
import { isAgentScope } from "./agentAuthz";

// ---------------------------------------------------------------------------
// OAuth 2.1 (auth-code + PKCE, device-code fallback) request/grant state
// (PRD v2.0 CD-07). This app has never been an OAuth *provider* before — only
// a client (Google/GitHub via Auth.js) — so this is a genuinely new
// subsystem. PKCE/device-code state lives in agent_oauth_requests
// (lib/db.ts), a short-lived table swept by the cleanup cron, not reused
// pending_uploads' NULL-until-done shape (that only models two states).
// ---------------------------------------------------------------------------

export const OAUTH_REQUEST_TTL_MS = 15 * 60 * 1000; // 15 minutes to complete consent
export const DEVICE_POLL_INTERVAL_SECONDS = 5;

export function generateOpaqueToken(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}

/** Human-friendly device user code, e.g. "WDJB-MJHT". */
export function generateUserCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
  const part = () =>
    Array.from({ length: 4 }, () => alphabet[randomBytes(1)[0] % alphabet.length]).join("");
  return `${part()}-${part()}`;
}

export function parseScopes(raw: string | null): AgentScope[] | { error: string } {
  const names = (raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (names.length === 0) return { error: "Provide at least one scope" };
  const invalid = names.filter((n) => !isAgentScope(n));
  if (invalid.length > 0) return { error: `Unknown scope(s): ${invalid.join(", ")}` };
  return Array.from(new Set(names)) as AgentScope[];
}

/** PKCE S256 verification: base64url(sha256(code_verifier)) === code_challenge. */
export function verifyPkce(codeVerifier: string, codeChallenge: string): boolean {
  const computed = createHash("sha256").update(codeVerifier).digest("base64url");
  return computed === codeChallenge;
}

export async function getOAuthRequest(id: string): Promise<AgentOAuthRequestRow | null> {
  try {
    const rows = await query<AgentOAuthRequestRow>(
      "SELECT * FROM agent_oauth_requests WHERE id = $1",
      [id],
    );
    return rows[0] ?? null;
  } catch {
    return null; // invalid uuid
  }
}

export function isExpired(row: AgentOAuthRequestRow): boolean {
  return new Date(row.expires_at).getTime() <= Date.now();
}
