import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { query, type SiteRow } from "@/lib/db";
import { putObject } from "@/lib/storage";
import { generateSlug, normalizeSlug } from "@/lib/slug";
import { expiresAtFrom, isTtlPreset } from "@/lib/ttl";
import { track } from "@/lib/events";

export const runtime = "nodejs";

const MAX_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 26_214_400);
const MAX_PAGES = 20;

/**
 * Make a stored filename safe: strip any path components, keep a conservative
 * character set, and require a .html extension. Returns null if unusable.
 */
function sanitizeFilename(name: string): string | null {
  const base = name.split(/[\\/]/).pop() || "";
  const cleaned = base
    .trim()
    .replace(/[^a-zA-Z0-9._ -]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+/, "");
  if (!/\.html?$/i.test(cleaned)) return null;
  if (cleaned.length < 6 || cleaned.length > 128) return null; // "a.html" = 6
  return cleaned;
}

export async function POST(req: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const form = await req.formData();
  const rawFiles = form.getAll("file").filter((f): f is File => f instanceof File);
  const ttl = String(form.get("ttl") || "");
  const requestedSlug = String(form.get("slug") || "").trim();
  const requestedIndex = String(form.get("index") || "").trim();
  const viewersRaw = String(form.get("viewers") || "");

  if (rawFiles.length === 0) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (rawFiles.length > MAX_PAGES) {
    return NextResponse.json(
      { error: `At most ${MAX_PAGES} pages per site` },
      { status: 400 },
    );
  }
  if (!isTtlPreset(ttl)) {
    return NextResponse.json(
      { error: "ttl must be one of 24h, 7d, 30d" },
      { status: 400 },
    );
  }

  // Validate + sanitize every file (single self-contained .html pages only).
  const files: { name: string; file: File }[] = [];
  const seen = new Set<string>();
  let totalBytes = 0;
  for (const f of rawFiles) {
    const isHtml = f.type === "text/html" || /\.html?$/i.test(f.name);
    if (!isHtml) {
      return NextResponse.json(
        { error: `"${f.name}": only .html files are accepted` },
        { status: 400 },
      );
    }
    const name = sanitizeFilename(f.name);
    if (!name) {
      return NextResponse.json(
        { error: `"${f.name}": unusable filename` },
        { status: 400 },
      );
    }
    if (seen.has(name)) {
      return NextResponse.json(
        { error: `Duplicate filename after sanitizing: ${name}` },
        { status: 400 },
      );
    }
    seen.add(name);
    totalBytes += f.size;
    files.push({ name, file: f });
  }
  if (totalBytes > MAX_BYTES) {
    return NextResponse.json(
      { error: `Files exceed max total size of ${MAX_BYTES} bytes` },
      { status: 413 },
    );
  }

  // Resolve the index page: explicit choice, single file, or index.html.
  let indexName: string;
  if (requestedIndex) {
    const match = sanitizeFilename(requestedIndex);
    if (!match || !seen.has(match)) {
      return NextResponse.json(
        { error: "index must name one of the uploaded files" },
        { status: 400 },
      );
    }
    indexName = match;
  } else if (files.length === 1) {
    indexName = files[0].name;
  } else {
    const auto = files.find((f) => f.name.toLowerCase() === "index.html");
    if (!auto) {
      return NextResponse.json(
        { error: "Multiple files: include an index.html or mark one as index" },
        { status: 400 },
      );
    }
    indexName = auto.name;
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
      return NextResponse.json({ error: "Slug already taken" }, { status: 409 });
    }
  } else {
    slug = await uniqueSlug();
  }

  const s3Prefix = `sites/${slug}-${Date.now().toString(36)}/`;
  for (const { name, file } of files) {
    const buffer = Buffer.from(await file.arrayBuffer());
    await putObject(`${s3Prefix}${name}`, buffer, "text/html; charset=utf-8");
  }
  const indexKey = `${s3Prefix}${indexName}`;

  const expiresAt = expiresAtFrom(ttl);
  const inserted = await query<SiteRow>(
    `INSERT INTO sites
       (slug, owner_email, s3_prefix, index_key, content_type, size_bytes, page_count, ttl_preset, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [slug, email, s3Prefix, indexKey, "text/html", totalBytes, files.length, ttl, expiresAt],
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

  await track("site_created", {
    siteId: site.id,
    actor: email,
    meta: { pages: files.length, ttl, bytes: totalBytes, viewers: viewers.length },
  });

  const base = process.env.NEXT_PUBLIC_BASE_URL || new URL(req.url).origin;
  return NextResponse.json({
    slug,
    url: `${base}/s/${slug}`,
    pages: files.length,
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
