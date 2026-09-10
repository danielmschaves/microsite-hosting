import { query } from "./db";

// ---------------------------------------------------------------------------
// Postgres-backed rate limiting (PRD v2.0 CD-12, NFR §11). No Redis: the
// zero-cloud-dependency / docker-compose-portability constraint rules it out
// as a required dependency, and rate_limit_buckets is a plain fixed-window
// counter table, same shape as the rest of this app's Postgres-only state.
// ---------------------------------------------------------------------------

export interface RateLimitResult {
  ok: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Fixed-window counter: increments the bucket for the current window and
 * checks it against `limit`. `windowSeconds` should be constant per
 * `bucketKey` prefix (e.g. always 60) so windows align.
 */
export async function checkRateLimit(
  bucketKey: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const windowMs = windowSeconds * 1000;
  const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);

  const rows = await query<{ count: number }>(
    `INSERT INTO rate_limit_buckets (bucket_key, window_start, count)
       VALUES ($1, $2, 1)
     ON CONFLICT (bucket_key, window_start) DO UPDATE
       SET count = rate_limit_buckets.count + 1
     RETURNING count`,
    [bucketKey, windowStart],
  );
  const count = rows[0].count;
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((windowStart.getTime() + windowMs - Date.now()) / 1000),
  );

  return {
    ok: count <= limit,
    limit,
    remaining: Math.max(0, limit - count),
    retryAfterSeconds,
  };
}

/** Sweep buckets from windows that have fully elapsed. Called by the cleanup cron. */
export async function sweepRateLimitBuckets(): Promise<number> {
  const deleted = await query<{ bucket_key: string }>(
    "DELETE FROM rate_limit_buckets WHERE window_start < now() - interval '1 hour' RETURNING bucket_key",
  );
  return deleted.length;
}
