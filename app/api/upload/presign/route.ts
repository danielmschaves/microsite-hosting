import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { query } from "@/lib/db";
import { presignUploadPost } from "@/lib/storage";
import {
  MAX_PAGES,
  sanitizeFilename,
  validateUploadRequest,
} from "@/lib/createSite";

export const runtime = "nodejs";

// Step 1 of the presigned path: validate everything that can be validated
// before bytes move (destination, plan, TTL, counts, declared sizes), then
// hand the browser one presigned POST per file. Every URL pins an exact key,
// the HTML content type, and a hard size range.
export async function POST(req: Request) {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const rawFiles: { name?: unknown; size?: unknown }[] = Array.isArray(body?.files)
    ? body.files
    : [];
  const ttl = String(body?.ttl || "");
  const workspaceId = String(body?.workspaceId || "").trim() || null;
  const visibilityRaw = String(body?.visibility || "allowlist");

  if (rawFiles.length === 0) {
    return NextResponse.json({ error: "No files declared" }, { status: 400 });
  }
  if (rawFiles.length > MAX_PAGES) {
    return NextResponse.json(
      { error: `At most ${MAX_PAGES} pages per site` },
      { status: 400 },
    );
  }

  const validated = await validateUploadRequest({
    email,
    ttl,
    workspaceId,
    visibilityRaw,
  });
  if ("error" in validated) return validated.error;

  const files: { name: string; size: number }[] = [];
  const seen = new Set<string>();
  let totalBytes = 0;
  for (const f of rawFiles) {
    const name = sanitizeFilename(String(f.name || ""));
    const size = Number(f.size);
    if (!name) {
      return NextResponse.json(
        { error: `"${String(f.name)}": unusable filename (only .html)` },
        { status: 400 },
      );
    }
    if (!Number.isFinite(size) || size < 1) {
      return NextResponse.json({ error: `"${name}": invalid size` }, { status: 400 });
    }
    if (seen.has(name)) {
      return NextResponse.json(
        { error: `Duplicate filename after sanitizing: ${name}` },
        { status: 400 },
      );
    }
    seen.add(name);
    totalBytes += size;
    files.push({ name, size });
  }
  if (totalBytes > validated.plan.maxSiteBytes) {
    return NextResponse.json(
      {
        error: `Files exceed the ${(validated.plan.maxSiteBytes / (1024 * 1024)).toFixed(0)} MB site limit${validated.plan.id === "free" ? " (Team plan allows 250 MB)" : ""}`,
      },
      { status: 413 },
    );
  }

  const uploadId = crypto.randomUUID();
  const s3Prefix = `sites/u-${uploadId}/`;
  await query(
    `INSERT INTO pending_uploads (id, owner_email, workspace_id, s3_prefix, files)
     VALUES ($1, $2, $3, $4, $5)`,
    [uploadId, email, workspaceId, s3Prefix, JSON.stringify(files)],
  );

  const presigned = await Promise.all(
    files.map(async (f) => ({
      name: f.name,
      ...(await presignUploadPost(`${s3Prefix}${f.name}`, validated.plan.maxSiteBytes)),
    })),
  );

  return NextResponse.json({ uploadId, files: presigned });
}
