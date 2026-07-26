import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The in-app bell: the caller's live sites expiring within 48h. This is a
// live condition, not an inbox — no read-state, nothing to mark as seen;
// extending a site simply removes it from the result.
export async function GET() {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await query<{
    id: string;
    slug: string;
    expires_at: Date;
  }>(
    `SELECT id, slug, expires_at
       FROM sites
      WHERE lower(owner_email) = $1
        AND deleted_at IS NULL
        AND expires_at > now()
        AND expires_at <= now() + interval '48 hours'
      ORDER BY expires_at ASC`,
    [email],
  );

  return NextResponse.json({
    items: rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      expiresAt: new Date(r.expires_at).toISOString(),
    })),
  });
}
