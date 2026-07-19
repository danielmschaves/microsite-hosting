import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { query, type SiteRow } from "@/lib/db";
import { putObject } from "@/lib/storage";
import { generateSlug, normalizeSlug } from "@/lib/slug";
import { expiresAtFrom, isTtlPreset } from "@/lib/ttl";

export const runtime = "nodejs";

const MAX_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 26_214_400);

export async function POST(req: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const form = await req.formData();
  const file = form.get("file");
  const ttl = String(form.get("ttl") || "");
  const requestedSlug = String(form.get("slug") || "").trim();
  const viewersRaw = String(form.get("viewers") || "");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  // Validate type: single self-contained HTML file only (MVP scope).
  const isHtml =
    file.type === "text/html" || file.name.toLowerCase().endsWith(".html");
  if (!isHtml) {
    return NextResponse.json(
      { error: "Only .html files are accepted" },
      { status: 400 },
    );
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File exceeds max size of ${MAX_BYTES} bytes` },
      { status: 413 },
    );
  }

  if (!isTtlPreset(ttl)) {
    return NextResponse.json(
      { error: "ttl must be one of 24h, 7d, 30d" },
      { status: 400 },
    );
  }

  // Resolve slug: use the requested one (validated) or generate a unique one.
  let slug: string | null;
  if (requestedSlug) {
    slug = normalizeSlug(requestedSlug);
    if (!slug) {
      return NextResponse.json(
        { error: "Invalid slug (use 3-63 lowercase letters, numbers, dashes)" },
        { status: 400 },
      );
    }
    const existing = await query<SiteRow>(
      "SELECT id FROM sites WHERE slug = $1 AND deleted_at IS NULL",
      [slug],
    );
    if (existing.length > 0) {
      return NextResponse.json(
        { error: "Slug already taken" },
        { status: 409 },
      );
    }
  } else {
    slug = await uniqueSlug();
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const s3Prefix = `sites/${slug}/`;
  const indexKey = `${s3Prefix}index.html`;

  await putObject(indexKey, buffer, "text/html; charset=utf-8");

  const expiresAt = expiresAtFrom(ttl);

  const inserted = await query<SiteRow>(
    `INSERT INTO sites
       (slug, owner_email, s3_prefix, index_key, content_type, size_bytes, ttl_preset, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [slug, email, s3Prefix, indexKey, "text/html", buffer.length, ttl, expiresAt],
  );
  const site = inserted[0];

  // Owner always has access; add any additional allowlisted viewer emails.
  const viewers = parseEmails(viewersRaw);
  for (const viewer of viewers) {
    await query(
      `INSERT INTO site_viewers (site_id, viewer_email)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [site.id, viewer],
    );
  }

  const base = process.env.NEXT_PUBLIC_BASE_URL || new URL(req.url).origin;
  return NextResponse.json({
    slug,
    url: `${base}/s/${slug}`,
    expiresAt: expiresAt.toISOString(),
  });
}

async function uniqueSlug(): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const candidate = generateSlug();
    const existing = await query(
      "SELECT 1 FROM sites WHERE slug = $1 AND deleted_at IS NULL",
      [candidate],
    );
    if (existing.length === 0) return candidate;
  }
  // Extremely unlikely fallback.
  return `${generateSlug()}-${Date.now().toString(36)}`;
}

function parseEmails(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(/[\s,;]+/)
        .map((e) => e.trim().toLowerCase())
        .filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)),
    ),
  );
}
