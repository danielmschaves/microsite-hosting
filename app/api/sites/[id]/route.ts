import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { query, type SiteRow } from "@/lib/db";
import { deletePrefix } from "@/lib/storage";
import { expiresAtFrom, isTtlPreset } from "@/lib/ttl";

export const runtime = "nodejs";

// Owner-initiated TTL extension: resets the countdown to now + the chosen
// preset. Also un-expires a site whose window recently lapsed (as long as the
// cron sweep hasn't hard-deleted it yet).
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const ttl = String(body?.ttl || "");
  if (!isTtlPreset(ttl)) {
    return NextResponse.json({ error: "ttl must be one of 24h, 7d, 30d" }, { status: 400 });
  }

  const rows = await query<SiteRow>(
    "SELECT * FROM sites WHERE id = $1 AND deleted_at IS NULL",
    [id],
  );
  const site = rows[0];
  if (!site) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (site.owner_email.toLowerCase() !== email.toLowerCase()) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const expiresAt = expiresAtFrom(ttl);
  await query("UPDATE sites SET ttl_preset = $1, expires_at = $2 WHERE id = $3", [
    ttl,
    expiresAt,
    id,
  ]);

  return NextResponse.json({ ok: true, expiresAt: expiresAt.toISOString() });
}

// Owner-initiated delete: removes stored objects and soft-deletes the row.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await query<SiteRow>(
    "SELECT * FROM sites WHERE id = $1 AND deleted_at IS NULL",
    [id],
  );
  const site = rows[0];
  if (!site) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (site.owner_email.toLowerCase() !== email.toLowerCase()) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await deletePrefix(site.s3_prefix);
  await query("UPDATE sites SET deleted_at = now() WHERE id = $1", [id]);

  return NextResponse.json({ ok: true });
}
