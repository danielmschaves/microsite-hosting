import { NextResponse } from "next/server";
import { query, type SiteRow } from "@/lib/db";
import { deletePrefix } from "@/lib/storage";
import { purgeSiteStorage } from "@/lib/createSite";
import { sendEmail, expiryEmail } from "@/lib/email";
import { track } from "@/lib/events";
import { TRASH_DAYS } from "@/lib/plan";
import { sweepRateLimitBuckets } from "@/lib/rateLimit";
import { sweepIdempotencyKeys } from "@/lib/idempotency";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// TTL sweep, called on a schedule with `Authorization: Bearer $CRON_SECRET`.
// Two phases (PRD §6.3):
//   1. Trash: expired sites move to the soft-delete trash (metadata flagged,
//      storage kept) so owners can restore them.
//   2. Purge: sites trashed more than TRASH_DAYS ago have their storage
//      deleted for good and are marked purged (no longer restorable).
// Serving stops at the exact expiry moment regardless — this job only manages
// storage lifecycle.
async function runCleanup(req: Request) {
  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization") || "";
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Phase 0 — expiry notices (T-48h / T-2h). Marker columns make this
  // idempotent at any cron cadence: a daily cron still sends the 48h notice
  // (possibly late) and simply misses most 2h windows. The marker is set
  // even when email is unconfigured — the in-app bell covers the user and
  // a misconfigured key must not retry-storm.
  const base = process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXTAUTH_URL || "";
  let notices = 0;
  for (const window of ["48h", "2h"] as const) {
    const col = window === "48h" ? "notified_48h_at" : "notified_2h_at";
    const hours = window === "48h" ? 48 : 2;
    const due = await query<SiteRow>(
      `SELECT * FROM sites
        WHERE deleted_at IS NULL
          AND expires_at > now()
          AND expires_at <= now() + make_interval(hours => $1)
          AND ${col} IS NULL`,
      [hours],
    );
    for (const site of due) {
      const msg = expiryEmail({
        slug: site.slug,
        window,
        expiresAt: new Date(site.expires_at),
        siteUrl: `${base}/s/${site.slug}`,
        manageUrl: `${base}/sites/${site.id}`,
      });
      await sendEmail({ to: site.owner_email, ...msg });
      await query(`UPDATE sites SET ${col} = now() WHERE id = $1`, [site.id]);
      await track("expiry_notice_sent", {
        siteId: site.id,
        workspaceId: site.workspace_id ?? undefined,
        meta: { window },
      });
      notices++;
    }
  }

  // Phase 1 — move newly expired sites to trash.
  const trashed = await query<{ id: string; slug: string }>(
    `UPDATE sites SET deleted_at = now()
      WHERE deleted_at IS NULL AND expires_at <= now()
      RETURNING id, slug`,
  );
  for (const site of trashed) {
    await track("site_trashed", { siteId: site.id, meta: { by: "cron", reason: "expired" } });
  }

  // Phase 2 — purge storage for sites past the trash window.
  const purgeable = await query<SiteRow>(
    `SELECT * FROM sites
      WHERE deleted_at IS NOT NULL
        AND purged_at IS NULL
        AND deleted_at <= now() - make_interval(days => $1)`,
    [TRASH_DAYS],
  );

  const purgeResults: { slug: string; ok: boolean }[] = [];
  for (const site of purgeable) {
    try {
      await purgeSiteStorage(site);
      await query("UPDATE sites SET purged_at = now() WHERE id = $1", [site.id]);
      await track("site_purged", { siteId: site.id, meta: { by: "cron" } });
      purgeResults.push({ slug: site.slug, ok: true });
    } catch (err) {
      console.error(`[cleanup] purge failed for ${site.slug}`, err);
      purgeResults.push({ slug: site.slug, ok: false });
    }
  }

  // Phase 3 — orphaned presigned uploads: started but never completed.
  const staleUploads = await query<{ id: string; s3_prefix: string }>(
    `SELECT id, s3_prefix FROM pending_uploads
      WHERE completed_at IS NULL AND created_at <= now() - interval '24 hours'`,
  );
  let orphansCleaned = 0;
  for (const u of staleUploads) {
    try {
      await deletePrefix(u.s3_prefix);
      await query("DELETE FROM pending_uploads WHERE id = $1", [u.id]);
      orphansCleaned++;
    } catch (err) {
      console.error(`[cleanup] orphan upload purge failed for ${u.id}`, err);
    }
  }
  // Completed rows are pure bookkeeping — drop them after a week.
  await query(
    "DELETE FROM pending_uploads WHERE completed_at IS NOT NULL AND completed_at <= now() - interval '7 days'",
  );

  // Phase 4 — Agent Gateway (PRD v2.0): sweep stale OAuth requests (PKCE +
  // device-code state that was never completed) and expired rate-limit /
  // idempotency-key bookkeeping. Same shape as phase 3's orphaned-upload
  // sweep — nothing here blocks product flows if it fails.
  const staleOAuthRequests = await query<{ id: string }>(
    `UPDATE agent_oauth_requests SET status = 'expired'
      WHERE status = 'pending' AND expires_at <= now()
      RETURNING id`,
  );
  await query(
    "DELETE FROM agent_oauth_requests WHERE status IN ('expired','denied','consumed') AND expires_at <= now() - interval '7 days'",
  );
  const rateLimitBucketsSwept = await sweepRateLimitBuckets();
  const idempotencyKeysSwept = await sweepIdempotencyKeys();

  return NextResponse.json({
    notices,
    trashed: trashed.length,
    purged: purgeResults.filter((r) => r.ok).length,
    orphansCleaned,
    purgeResults,
    agentGateway: {
      oauthRequestsExpired: staleOAuthRequests.length,
      rateLimitBucketsSwept,
      idempotencyKeysSwept,
    },
  });
}

export async function POST(req: Request) {
  return runCleanup(req);
}

// GET is also accepted so simple cron providers that only issue GETs work.
export async function GET(req: Request) {
  return runCleanup(req);
}
