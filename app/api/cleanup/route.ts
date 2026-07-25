import { NextResponse } from "next/server";
import { query, type SiteRow } from "@/lib/db";
import { deletePrefix } from "@/lib/storage";
import { track } from "@/lib/events";
import { TRASH_DAYS } from "@/lib/plan";

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
      await deletePrefix(site.s3_prefix);
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

  return NextResponse.json({
    trashed: trashed.length,
    purged: purgeResults.filter((r) => r.ok).length,
    orphansCleaned,
    purgeResults,
  });
}

export async function POST(req: Request) {
  return runCleanup(req);
}

// GET is also accepted so simple cron providers that only issue GETs work.
export async function GET(req: Request) {
  return runCleanup(req);
}
