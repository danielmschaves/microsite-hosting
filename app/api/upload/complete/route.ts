import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { query } from "@/lib/db";
import { listPrefix, deletePrefix, s3, BUCKET } from "@/lib/storage";
import { DeleteObjectsCommand } from "@aws-sdk/client-s3";
import {
  parseEmails,
  validateUploadRequest,
  resolveIndex,
  resolveSlug,
  createSiteRecord,
} from "@/lib/createSite";

export const runtime = "nodejs";

interface PendingRow {
  id: string;
  owner_email: string;
  workspace_id: string | null;
  s3_prefix: string;
  files: { name: string; size: number }[];
  completed_at: Date | null;
}

// Step 2 of the presigned path: after the browser has POSTed the files to S3,
// verify server-side truth (every declared file exists; nothing undeclared
// under the prefix; recomputed sizes within plan limits) and create the site.
export async function POST(req: Request) {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const uploadId = String(body?.uploadId || "");
  const ttl = String(body?.ttl || "");
  const requestedSlug = String(body?.slug || "").trim();
  const requestedIndex = String(body?.index || "").trim();
  const viewersRaw = String(body?.viewers || "");
  const workspaceId = String(body?.workspaceId || "").trim() || null;
  const visibilityRaw = String(body?.visibility || "allowlist");

  let pending: PendingRow | undefined;
  try {
    pending = (
      await query<PendingRow>("SELECT * FROM pending_uploads WHERE id = $1", [
        uploadId,
      ])
    )[0];
  } catch {
    // invalid uuid
  }
  if (!pending || pending.owner_email !== email) {
    return NextResponse.json({ error: "Upload not found" }, { status: 404 });
  }
  if (pending.completed_at) {
    return NextResponse.json({ error: "Upload already completed" }, { status: 409 });
  }

  // Re-run the full validation (plan/TTL/visibility/counts) at completion
  // time — state may have changed since presign.
  const validated = await validateUploadRequest({
    email,
    ttl,
    workspaceId,
    visibilityRaw,
  });
  if ("error" in validated) return validated.error;

  // Server-side truth from storage.
  const declared = new Map(pending.files.map((f) => [f.name, f.size]));
  const stored = await listPrefix(pending.s3_prefix);

  // Delete anything under the prefix that was never declared (belt-and-braces:
  // the presigned conditions already pin exact keys).
  const undeclared = stored.filter((f) => !declared.has(f.name));
  if (undeclared.length > 0) {
    await s3.send(
      new DeleteObjectsCommand({
        Bucket: BUCKET,
        Delete: {
          Objects: undeclared.map((f) => ({ Key: `${pending.s3_prefix}${f.name}` })),
        },
      }),
    );
  }
  const usable = stored.filter((f) => declared.has(f.name));

  const missing = [...declared.keys()].filter(
    (name) => !usable.some((f) => f.name === name),
  );
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Missing uploaded files: ${missing.join(", ")}` },
      { status: 400 },
    );
  }

  const totalBytes = usable.reduce((s, f) => s + f.size, 0);
  if (totalBytes > validated.plan.maxSiteBytes) {
    await deletePrefix(pending.s3_prefix);
    await query("DELETE FROM pending_uploads WHERE id = $1", [uploadId]);
    return NextResponse.json(
      { error: "Uploaded files exceed the plan size limit" },
      { status: 413 },
    );
  }

  const idx = resolveIndex(
    usable.map((f) => f.name),
    requestedIndex,
  );
  if ("error" in idx) {
    return NextResponse.json({ error: idx.error }, { status: 400 });
  }

  const slugRes = await resolveSlug(requestedSlug);
  if ("error" in slugRes) {
    return NextResponse.json({ error: slugRes.error }, { status: slugRes.status });
  }

  const site = await createSiteRecord({
    email,
    slug: slugRes.slug,
    s3Prefix: pending.s3_prefix,
    indexName: idx.indexName,
    totalBytes,
    pageCount: usable.length,
    ttl: validated.ttl,
    workspaceId: validated.workspaceId,
    visibility: validated.visibility,
    viewers: parseEmails(viewersRaw),
  });
  await query("UPDATE pending_uploads SET completed_at = now() WHERE id = $1", [
    uploadId,
  ]);

  const base = process.env.NEXT_PUBLIC_BASE_URL || new URL(req.url).origin;
  return NextResponse.json({
    slug: site.slug,
    url: `${base}/s/${site.slug}`,
    pages: usable.length,
    expiresAt: new Date(site.expires_at).toISOString(),
  });
}
