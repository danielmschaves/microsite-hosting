import { createHash } from "crypto";
import { query } from "./db";

// ---------------------------------------------------------------------------
// Idempotency-Key replay (PRD v2.0 CD-12, NFR §11): "Every mutating REST and
// MCP call accepts an idempotency key; replays within 24h return the
// original result. Mandatory for publish and rollback." Postgres-backed,
// same portability reasoning as lib/rateLimit.ts. Replaying "within 24h" is
// automatic — once the cleanup cron sweeps a row past 24h, the key is simply
// treated as new on the next call.
// ---------------------------------------------------------------------------

export interface IdempotentResponse {
  status: number;
  body: unknown;
}

async function hashRequest(method: string, url: string, bodyText: string): Promise<string> {
  return createHash("sha256").update(`${method}\n${url}\n${bodyText}`).digest("hex");
}

/**
 * Run `handler` under idempotency-key replay semantics for `tokenId`. If
 * `key` is null, idempotency is not requested — the handler simply runs
 * (callers that require an Idempotency-Key check for its presence
 * themselves before calling this, e.g. publish/rollback per the NFR).
 */
export async function withIdempotency(
  opts: { key: string | null; tokenId: string; method: string; url: string; bodyText: string },
  handler: () => Promise<IdempotentResponse>,
): Promise<IdempotentResponse | { status: 409; body: { error: string; message: string } }> {
  if (!opts.key) return handler();

  const requestHash = await hashRequest(opts.method, opts.url, opts.bodyText);
  const existing = await query<{
    request_hash: string;
    response_status: number;
    response_body: unknown;
  }>(
    "SELECT request_hash, response_status, response_body FROM idempotency_keys WHERE key = $1 AND token_id = $2",
    [opts.key, opts.tokenId],
  );

  if (existing[0]) {
    if (existing[0].request_hash !== requestHash) {
      return {
        status: 409,
        body: {
          error: "idempotency_conflict",
          message: "This Idempotency-Key was already used with a different request.",
        },
      };
    }
    return { status: existing[0].response_status, body: existing[0].response_body };
  }

  const result = await handler();
  await query(
    `INSERT INTO idempotency_keys (key, token_id, request_hash, response_status, response_body)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (key) DO NOTHING`,
    [opts.key, opts.tokenId, requestHash, result.status, JSON.stringify(result.body)],
  );
  return result;
}

/** Sweep keys older than 24h. Called by the cleanup cron. */
export async function sweepIdempotencyKeys(): Promise<number> {
  const deleted = await query<{ key: string }>(
    "DELETE FROM idempotency_keys WHERE created_at < now() - interval '24 hours' RETURNING key",
  );
  return deleted.length;
}
