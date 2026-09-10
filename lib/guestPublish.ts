import { randomBytes, createHash } from "crypto";
import { query, type SiteRow, type GuestSiteRow } from "./db";
import { createSiteRecord, sanitizeFilename } from "./createSite";
import { generateSlug } from "./slug";
import { putObject } from "./storage";
import { expiresAtFrom } from "./ttl";
import { checkRateLimit } from "./rateLimit";
import { track } from "./events";

// ---------------------------------------------------------------------------
// Guest (no-signup) publish + claim (PRD v2.0 CD-18). Deliberately NOT built
// on lib/uploadService.ts's performServerUpload, which assumes an
// authenticated email and workspace/plan context that doesn't exist for an
// anonymous visitor — a guest trial has its own, much stricter rules
// (single file, 5MB cap, fixed 24h/public, no workspace) that don't map
// onto the plan-gated multi-file path at all.
// ---------------------------------------------------------------------------

export const GUEST_MAX_BYTES = 5 * 1024 * 1024;
export const GUEST_TOKEN_COOKIE = "mb_guest_token";
export const GUEST_TOKEN_MAX_AGE_SECONDS = 24 * 60 * 60;

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Same construction as agent-token secrets — random, opaque, never guessable. */
export function generateGuestToken(): string {
  return randomBytes(24).toString("base64url");
}

/** 3 publishes/hour per IP — the guest-abuse surface's primary mitigation. */
export async function checkGuestPublishRateLimit(
  ip: string,
): Promise<{ ok: boolean; retryAfterSeconds: number }> {
  const r = await checkRateLimit(`guest-publish:ip:${hash(ip)}`, 3, 3600);
  return { ok: r.ok, retryAfterSeconds: r.retryAfterSeconds };
}

export type GuestPublishOutcome =
  | { ok: true; site: SiteRow; guestToken: string; trialId: string }
  | { ok: false; error: string; status: number };

/**
 * Publish a single anonymous trial site: fixed 24h TTL, fixed public
 * visibility (reuses the already-shipped noindex behavior for public sites —
 * zero new serving code needed), a synthetic .invalid owner email so the
 * NOT NULL owner_email constraint is satisfied concretely without ever being
 * deliverable or colliding with a real account.
 */
export async function publishGuestSite(opts: {
  filename: string;
  content: Buffer;
  ip: string;
  existingGuestToken?: string | null;
}): Promise<GuestPublishOutcome> {
  if (opts.content.length === 0) {
    return { ok: false, error: "The file is empty", status: 400 };
  }
  if (opts.content.length > GUEST_MAX_BYTES) {
    return {
      ok: false,
      error: `Guest uploads are capped at ${Math.floor(GUEST_MAX_BYTES / (1024 * 1024))}MB`,
      status: 413,
    };
  }
  const name = sanitizeFilename(opts.filename);
  if (!name) {
    return { ok: false, error: "Provide a single .html file", status: 400 };
  }

  const slug = generateSlug();
  const s3Prefix = `sites/${slug}-${Date.now()}/`;
  await putObject(`${s3Prefix}${name}`, opts.content, "text/html; charset=utf-8");

  const email = `guest+${randomBytes(8).toString("hex")}@guest.microbuild.invalid`;

  const site = await createSiteRecord({
    email,
    slug,
    s3Prefix,
    indexName: name,
    totalBytes: opts.content.length,
    pageCount: 1,
    ttl: "24h",
    workspaceId: null,
    visibility: "public",
    viewers: [],
    actorType: "human",
    source: "upload",
  });

  const guestToken = opts.existingGuestToken || generateGuestToken();
  const inserted = await query<{ trial_id: string }>(
    `INSERT INTO guest_sites (guest_token_hash, site_id, ip_hash, expires_at)
     VALUES ($1, $2, $3, $4)
     RETURNING trial_id`,
    [hash(guestToken), site.id, hash(opts.ip), site.expires_at],
  );

  await track("guest_site_published", {
    siteId: site.id,
    meta: { ipHash: hash(opts.ip) },
  });

  return { ok: true, site, guestToken, trialId: inserted[0].trial_id };
}

export interface ClaimedSite {
  id: string;
  slug: string;
}

/**
 * Claim every unclaimed, unexpired guest site matching `guestToken` (or just
 * `trialId` when given) to `claimedBy`. Extends the TTL to 7d and clears
 * notification markers — a freshly-claimed site must not expire minutes
 * after someone signed up specifically to keep it. Proof of ownership is
 * simply possession of the raw token (never rendered/logged anywhere) —
 * same hash-and-lookup pattern as every other credential in this codebase.
 */
export async function claimGuestSites(opts: {
  guestToken: string;
  claimedBy: string;
  trialId?: string;
}): Promise<ClaimedSite[]> {
  const tokenHash = hash(opts.guestToken);
  const rows = opts.trialId
    ? await query<GuestSiteRow & { slug: string }>(
        `SELECT g.*, s.slug FROM guest_sites g
           JOIN sites s ON s.id = g.site_id
          WHERE g.guest_token_hash = $1 AND g.trial_id = $2 AND g.claimed_by IS NULL
            AND s.deleted_at IS NULL AND s.purged_at IS NULL`,
        [tokenHash, opts.trialId],
      )
    : await query<GuestSiteRow & { slug: string }>(
        `SELECT g.*, s.slug FROM guest_sites g
           JOIN sites s ON s.id = g.site_id
          WHERE g.guest_token_hash = $1 AND g.claimed_by IS NULL
            AND s.deleted_at IS NULL AND s.purged_at IS NULL`,
        [tokenHash],
      );

  const claimed: ClaimedSite[] = [];
  const expiresAt = expiresAtFrom("7d");
  for (const row of rows) {
    await query(
      `UPDATE sites SET owner_email = $1, ttl_preset = '7d', expires_at = $2,
              notified_48h_at = NULL, notified_2h_at = NULL
        WHERE id = $3`,
      [opts.claimedBy, expiresAt, row.site_id],
    );
    await query(
      "UPDATE guest_sites SET claimed_by = $1, claimed_at = now() WHERE trial_id = $2",
      [opts.claimedBy, row.trial_id],
    );
    await track("site_claimed", {
      siteId: row.site_id,
      actor: opts.claimedBy,
      meta: { trialId: row.trial_id },
    });
    claimed.push({ id: row.site_id, slug: row.slug });
  }
  return claimed;
}
