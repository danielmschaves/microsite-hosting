import { NextResponse } from "next/server";
import { putObject } from "./storage";
import type { SiteRow } from "./db";
import {
  MAX_PAGES,
  sanitizeFilename,
  parseEmails,
  validateUploadRequest,
  resolveIndex,
  resolveSlug,
  createSiteRecord,
  publishSiteVersion,
} from "./createSite";

// Server-transiting upload core, shared by the session multipart route
// (/api/upload) and the token-authenticated v1 API. Bytes move through the
// function, so the cap stays well under serverless body limits — larger
// sites use the presigned browser->S3 path.

export const SERVER_UPLOAD_MAX_BYTES = Number(
  process.env.SERVER_UPLOAD_MAX_BYTES || 4 * 1024 * 1024,
);

export interface UploadResult {
  site: SiteRow;
  pages: number;
  version: number;
  republished: boolean;
}

export async function performServerUpload(opts: {
  email: string;
  rawFiles: File[];
  ttl: string;
  requestedSlug: string;
  requestedIndex: string;
  viewersRaw: string;
  workspaceId: string | null;
  visibilityRaw: string;
  /** PUT /v1/sites/{slug}/content: the slug must already exist and be owned. */
  requireExisting?: boolean;
  meta?: Record<string, unknown>;
}): Promise<{ error: NextResponse } | UploadResult> {
  const err = (message: string, status: number) => ({
    error: NextResponse.json({ error: message }, { status }),
  });

  if (opts.rawFiles.length === 0) return err("No file provided", 400);
  if (opts.rawFiles.length > MAX_PAGES) {
    return err(`At most ${MAX_PAGES} pages per site`, 400);
  }

  const slugRes = await resolveSlug(opts.requestedSlug, opts.email);
  if ("error" in slugRes) return err(slugRes.error, slugRes.status);
  if (opts.requireExisting && !slugRes.existing) {
    return err("No live site with that slug under your account", 404);
  }
  const { slug, existing } = slugRes;

  const validated = await validateUploadRequest({
    email: opts.email,
    ttl: opts.ttl,
    workspaceId: opts.workspaceId,
    visibilityRaw: opts.visibilityRaw,
    updating: existing,
  });
  if ("error" in validated) return validated;

  // Validate + sanitize every file (self-contained .html pages only).
  const files: { name: string; file: File }[] = [];
  const seen = new Set<string>();
  let totalBytes = 0;
  for (const f of opts.rawFiles) {
    const isHtml = f.type === "text/html" || /\.html?$/i.test(f.name);
    if (!isHtml) return err(`"${f.name}": only .html files are accepted`, 400);
    const name = sanitizeFilename(f.name);
    if (!name) return err(`"${f.name}": unusable filename`, 400);
    if (seen.has(name)) return err(`Duplicate filename after sanitizing: ${name}`, 400);
    seen.add(name);
    totalBytes += f.size;
    files.push({ name, file: f });
  }

  const sizeCap = Math.min(validated.plan.maxSiteBytes, SERVER_UPLOAD_MAX_BYTES);
  if (totalBytes > sizeCap) {
    return err(
      `Files exceed the ${(sizeCap / (1024 * 1024)).toFixed(0)} MB limit for direct upload — larger sites use the browser upload path`,
      413,
    );
  }

  const idx = resolveIndex(
    files.map((f) => f.name),
    opts.requestedIndex,
  );
  if ("error" in idx) return err(idx.error, 400);

  const s3Prefix = `sites/${slug}-${Date.now().toString(36)}/`;
  for (const { name, file } of files) {
    const buffer = Buffer.from(await file.arrayBuffer());
    await putObject(`${s3Prefix}${name}`, buffer, "text/html; charset=utf-8");
  }

  if (existing) {
    const published = await publishSiteVersion({
      site: existing,
      email: opts.email,
      s3Prefix,
      indexName: idx.indexName,
      totalBytes,
      pageCount: files.length,
      ttl: validated.ttl,
      versionLimit: validated.plan.versionLimit,
    });
    return {
      site: published.site,
      pages: files.length,
      version: published.version,
      republished: true,
    };
  }

  const site = await createSiteRecord({
    email: opts.email,
    slug,
    s3Prefix,
    indexName: idx.indexName,
    totalBytes,
    pageCount: files.length,
    ttl: validated.ttl,
    workspaceId: validated.workspaceId,
    visibility: validated.visibility,
    viewers: parseEmails(opts.viewersRaw),
  });
  return { site, pages: files.length, version: 1, republished: false };
}
