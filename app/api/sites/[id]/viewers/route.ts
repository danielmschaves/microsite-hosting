import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { query, type SiteRow } from "@/lib/db";
import { track } from "@/lib/events";

export const runtime = "nodejs";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Load the site and verify the session user owns it. */
async function authorize(id: string) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const rows = await query<SiteRow>(
    "SELECT * FROM sites WHERE id = $1 AND purged_at IS NULL",
    [id],
  );
  const site = rows[0];
  if (!site) {
    return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }
  if (site.owner_email.toLowerCase() !== email.toLowerCase()) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { site, email };
}

// GET — list allowlisted viewer emails.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const res = await authorize(id);
  if ("error" in res) return res.error;

  const rows = await query<{ viewer_email: string }>(
    "SELECT viewer_email FROM site_viewers WHERE site_id = $1 ORDER BY viewer_email",
    [id],
  );
  return NextResponse.json({ viewers: rows.map((r) => r.viewer_email) });
}

// POST — add a viewer: { email }. Takes effect immediately.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const res = await authorize(id);
  if ("error" in res) return res.error;

  const body = await req.json().catch(() => ({}));
  const viewer = String(body?.email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(viewer)) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }

  await query(
    `INSERT INTO site_viewers (site_id, viewer_email)
     VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [id, viewer],
  );
  await track("viewer_added", { siteId: id, actor: res.email, meta: { viewer } });
  return NextResponse.json({ ok: true });
}

// DELETE — remove a viewer: { email }. Revokes access immediately.
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const res = await authorize(id);
  if ("error" in res) return res.error;

  const body = await req.json().catch(() => ({}));
  const viewer = String(body?.email || "").trim().toLowerCase();
  if (!viewer) {
    return NextResponse.json({ error: "email required" }, { status: 400 });
  }

  await query(
    "DELETE FROM site_viewers WHERE site_id = $1 AND lower(viewer_email) = $2",
    [id, viewer],
  );
  await track("viewer_removed", { siteId: id, actor: res.email, meta: { viewer } });
  return NextResponse.json({ ok: true });
}
