import { NextResponse } from "next/server";
import { query, type SiteRow } from "@/lib/db";
import { deletePrefix } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// TTL sweep. Intended to be called on a schedule (e.g. Vercel Cron or any
// external scheduler) with `Authorization: Bearer $CRON_SECRET`. Deletes the
// stored objects for expired sites and soft-deletes their metadata rows.
async function runCleanup(req: Request) {
  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization") || "";
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const expired = await query<SiteRow>(
    `SELECT * FROM sites
      WHERE deleted_at IS NULL AND expires_at <= now()`,
  );

  const results: { slug: string; ok: boolean }[] = [];
  for (const site of expired) {
    try {
      await deletePrefix(site.s3_prefix);
      await query("UPDATE sites SET deleted_at = now() WHERE id = $1", [
        site.id,
      ]);
      results.push({ slug: site.slug, ok: true });
    } catch (err) {
      console.error(`[cleanup] failed for ${site.slug}`, err);
      results.push({ slug: site.slug, ok: false });
    }
  }

  return NextResponse.json({
    scanned: expired.length,
    deleted: results.filter((r) => r.ok).length,
    results,
  });
}

export async function POST(req: Request) {
  return runCleanup(req);
}

// GET is also accepted so simple cron providers that only issue GETs work.
export async function GET(req: Request) {
  return runCleanup(req);
}
