import { createHmac, timingSafeEqual } from "crypto";

// ---------------------------------------------------------------------------
// Two-step confirmation tokens for destructive agent tools (publish_site,
// rollback_to_version, delete_site — PRD v2.0 CD-09). Step 1 returns a
// short-lived HMAC-signed token binding {action, resourceId, tokenId, exp};
// step 2 requires it back. Keyed on AUTH_SECRET (already provisioned for
// Auth.js) — no new secret to manage, no new table needed.
// ---------------------------------------------------------------------------

const CONFIRM_TTL_MS = 5 * 60 * 1000;

interface ConfirmPayload {
  action: string;
  resourceId: string;
  tokenId: string;
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

/**
 * Mint a confirmation token for `action` on `resourceId`, bound to the
 * caller's token. `ttlMs` defaults to 5 minutes; publish_site/
 * rollback_to_version pass 10 minutes explicitly per CD-16's NFR — one
 * mechanism, two TTLs, rather than a second token type.
 */
export function createConfirmToken(
  action: string,
  resourceId: string,
  tokenId: string,
  ttlMs: number = CONFIRM_TTL_MS,
): string {
  const payload: ConfirmPayload = {
    action,
    resourceId,
    tokenId,
    exp: Date.now() + ttlMs,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${payloadB64}.${sign(payloadB64)}`;
}

/**
 * Verify a confirmation token matches `action`/`resourceId`/`tokenId` and has
 * not expired. Constant-time signature comparison (no stored-secret lookup
 * to time — same rationale as the token-hashing "GitHub pattern" elsewhere).
 */
export function verifyConfirmToken(
  confirmToken: string,
  action: string,
  resourceId: string,
  tokenId: string,
): { ok: true } | { ok: false; reason: string } {
  const parts = confirmToken.split(".");
  if (parts.length !== 2) return { ok: false, reason: "malformed token" };
  const [payloadB64, signature] = parts;

  const expected = sign(payloadB64);
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(signature);
  if (
    expectedBuf.length !== actualBuf.length ||
    !timingSafeEqual(expectedBuf, actualBuf)
  ) {
    return { ok: false, reason: "invalid signature" };
  }

  let payload: ConfirmPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed payload" };
  }

  if (payload.action !== action || payload.resourceId !== resourceId || payload.tokenId !== tokenId) {
    return { ok: false, reason: "token does not match this request" };
  }
  if (Date.now() > payload.exp) {
    return { ok: false, reason: "token expired" };
  }
  return { ok: true };
}
