import { createHmac, timingSafeEqual } from "crypto";

// ---------------------------------------------------------------------------
// Signed cookie for password-gated preview deployments (PRD v2.0 CD-15).
// Same HMAC-over-base64url-JSON construction as lib/agentConfirm.ts, keyed
// on the same AUTH_SECRET — but a separate, simpler payload shape
// ({deploymentId, exp}) since this isn't a two-step confirmation, it's a
// "you already proved you know the password" cookie. The cookie never
// carries the password itself, only proof it was checked once.
// ---------------------------------------------------------------------------

const COOKIE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const PREVIEW_COOKIE_MAX_AGE_SECONDS = COOKIE_TTL_MS / 1000;

interface PreviewAccessPayload {
  deploymentId: string;
  exp: number;
}

function secretKey(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not configured");
  return secret;
}

function sign(payloadB64: string): string {
  return createHmac("sha256", secretKey()).update(payloadB64).digest("base64url");
}

export function previewCookieName(deploymentId: string): string {
  return `mb_preview_pw_${deploymentId}`;
}

/** Mint a signed cookie value proving the caller already passed the password check for `deploymentId`. */
export function signPreviewAccess(deploymentId: string): string {
  const payload: PreviewAccessPayload = { deploymentId, exp: Date.now() + COOKIE_TTL_MS };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${payloadB64}.${sign(payloadB64)}`;
}

/** Verify a cookie value proves access to exactly `deploymentId`, unexpired. */
export function verifyPreviewAccess(token: string, deploymentId: string): boolean {
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [payloadB64, signature] = parts;

  const expected = sign(payloadB64);
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(signature);
  if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
    return false;
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as PreviewAccessPayload;
    return payload.deploymentId === deploymentId && Date.now() <= payload.exp;
  } catch {
    return false;
  }
}

/** Parse a raw Cookie header into a name->value map (no dependency needed for this one lookup). */
export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name) out[name] = decodeURIComponent(value);
  }
  return out;
}
