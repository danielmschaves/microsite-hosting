import { NextResponse } from "next/server";
import { requestBase } from "@/lib/url";
import { auth } from "@/auth";
import { putObject } from "@/lib/storage";
import {
  MAX_PAGES,
  sanitizeFilename,
  parseEmails,
  validateUploadRequest,
  resolveIndex,
  resolveSlug,
  createSiteRecord,
  publishSiteVersion,
} from "@/lib/createSite";

export const runtime = "nodejs";

// Multipart fallback path: files transit the app server, so this is capped
// well under Vercel's ~4.5MB function body limit. Large uploads go through
// the presigned browser->S3 path (/api/upload/presign + /complete).
const SERVER_UPLOAD_MAX_BYTES = Number(
  process.env.SERVER_UPLOAD_MAX_BYTES || 4 * 1024 * 1024,
);

export async function POST(req: Request) {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const form = await req.formData();
  const rawFiles = form.getAll("file").filter((f): f is File => f instanceof File);
  const ttl = String(form.get("ttl") || "");
  const requestedSlug = String(form.get("slug") || "").trim();
  const requestedIndex = String(form.get("index") || "").trim();
  const viewersRaw = String(form.get("viewers") || "");
  const workspaceId = String(form.get("workspaceId") || "").trim() || null;
  const visibilityRaw = String(form.get("visibility") || "allowlist");

  if (rawFiles.length === 0) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (rawFiles.length > MAX_PAGES) {
    return NextResponse.json(
      { error: `At most ${MAX_PAGES} pages per site` },
      { status: 400 },
    );
  }

  // Resolve the slug first: a live slug owned by this user turns the upload
  // into a re-publish (new version, same URL) with the site's own settings.
  const slugRes = await resolveSlug(requestedSlug, email);
  if ("error" in slugRes) {
    return NextResponse.json({ error: slugRes.error }, { status: slugRes.status });
  }
  const { slug, existing } = slugRes;

  const validated = await validateUploadRequest({
    email,
    ttl,
    workspaceId,
    visibilityRaw,
    updating: existing,
  });
  if ("error" in validated) return validated.error;

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

  const sizeCap = Math.min(validated.plan.maxSiteBytes, SERVER_UPLOAD_MAX_BYTES);
  if (totalBytes > sizeCap) {
    return NextResponse.json(
      {
        error: `Files exceed the ${(sizeCap / (1024 * 1024)).toFixed(0)} MB limit for direct upload — larger sites use the browser upload path`,
      },
      { status: 413 },
    );
  }

  const idx = resolveIndex(
    files.map((f) => f.name),
    requestedIndex,
  );
  if ("error" in idx) {
    return NextResponse.json({ error: idx.error }, { status: 400 });
  }

  const s3Prefix = `sites/${slug}-${Date.now().toString(36)}/`;
  for (const { name, file } of files) {
    const buffer = Buffer.from(await file.arrayBuffer());
    await putObject(`${s3Prefix}${name}`, buffer, "text/html; charset=utf-8");
  }

  let site;
  let version = 1;
  if (existing) {
    const published = await publishSiteVersion({
      site: existing,
      email,
      s3Prefix,
      indexName: idx.indexName,
      totalBytes,
      pageCount: files.length,
      ttl: validated.ttl,
      versionLimit: validated.plan.versionLimit,
    });
    site = published.site;
    version = published.version;
  } else {
    site = await createSiteRecord({
      email,
      slug,
      s3Prefix,
      indexName: idx.indexName,
      totalBytes,
      pageCount: files.length,
      ttl: validated.ttl,
      workspaceId: validated.workspaceId,
      visibility: validated.visibility,
      viewers: parseEmails(viewersRaw),
    });
  }

  const base = requestBase(req);
  return NextResponse.json({
    slug: site.slug,
    url: `${base}/s/${site.slug}`,
    pages: files.length,
    version,
    republished: Boolean(existing),
    expiresAt: new Date(site.expires_at).toISOString(),
  });
}
