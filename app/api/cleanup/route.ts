import { NextResponse } from "next/server";
import { query, type SiteRow, type DeploymentRow, type VersionRow } from "@/lib/db";
import { deletePrefix } from "@/lib/storage";
import { purgeSiteStorage } from "@/lib/createSite";
import { sendEmail, expiryEmail } from "@/lib/email";
import { track } from "@/lib/events";
import { TRASH_DAYS } from "@/lib/plan";
import { sweepRateLimitBuckets } from "@/lib/rateLimit";
import { sweepIdempotencyKeys } from "@/lib/idempotency";
import { transitionDeployment } from "@/lib/deployments";

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

  // Phase 2 — purge storage for sites past the trash window. Unclaimed
  // guest-trial sites (CD-18/CD-19) are the one exception to the grace
  // period: no owner ever confirmed they want the content kept around, so
  // they purge as soon as they're trashed rather than waiting TRASH_DAYS —
  // an explicit tightening, not an oversight (see CLAUDE.md's Agent Gateway
  // risk notes).
  const purgeable = await query<SiteRow>(
    `SELECT s.* FROM sites s
       LEFT JOIN guest_sites g ON g.site_id = s.id AND g.claimed_by IS NULL
      WHERE s.deleted_at IS NOT NULL
        AND s.purged_at IS NULL
        AND (s.deleted_at <= now() - make_interval(days => $1) OR g.trial_id IS NOT NULL)`,
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

  // Phase 5 — PRD v2.0 R2 (CD-19): approvals sweep, orphaned preview
  // deployments. Unclaimed-guest-site purging is folded into phase 2 above
  // (same purgeSiteStorage/site-row lifecycle, just a different eligibility
  // condition) rather than duplicated here.
  const approvalsExpired = await query<{ id: string }>(
    `UPDATE approvals SET status = 'expired'
      WHERE status = 'pending' AND expires_at <= now()
      RETURNING id`,
  );
  for (const a of approvalsExpired) {
    await track("approval_expired", { meta: { approvalId: a.id } });
  }
  const approvalsDeleted = await query<{ id: string }>(
    `DELETE FROM approvals
      WHERE status IN ('approved','rejected','expired') AND created_at <= now() - interval '30 days'
      RETURNING id`,
  );

  // Orphaned preview deployments: never promoted/canceled, older than the
  // same TRASH_DAYS window used for trashed-site storage. Deployment rows
  // themselves are never deleted (audit-trail-forever, matching every other
  // history table in this app) — only their storage is freed and their
  // status moves to 'canceled', a legal transition from all three states.
  const orphanedDeployments = await query<DeploymentRow>(
    `SELECT * FROM deployments
      WHERE status IN ('queued','building','ready')
        AND created_at <= now() - make_interval(days => $1)`,
    [TRASH_DAYS],
  );
  let previewsCleaned = 0;
  for (const d of orphanedDeployments) {
    try {
      const versionRows = await query<VersionRow>("SELECT * FROM versions WHERE id = $1", [
        d.version_id,
      ]);
      if (versionRows[0]) {
        await deletePrefix(versionRows[0].storage_key);
      }
      await transitionDeployment(d.id, "canceled");
      previewsCleaned++;
    } catch (err) {
      console.error(`[cleanup] orphaned deployment cleanup failed for ${d.id}`, err);
    }
  }

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
      approvalsExpired: approvalsExpired.length,
      approvalsDeleted: approvalsDeleted.length,
      previewsCleaned,
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
