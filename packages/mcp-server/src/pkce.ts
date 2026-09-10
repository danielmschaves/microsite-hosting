import { createHash, randomBytes } from "crypto";

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** S256 PKCE challenge for a given verifier. */
export function codeChallengeFor(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}
