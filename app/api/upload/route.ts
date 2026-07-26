import { NextResponse } from "next/server";
import { requestBase } from "@/lib/url";
import { auth } from "@/auth";
import { performServerUpload } from "@/lib/uploadService";

export const runtime = "nodejs";

// Multipart fallback path: files transit the app server, so this is capped
// well under Vercel's ~4.5MB function body limit. Large uploads go through
// the presigned browser->S3 path (/api/upload/presign + /complete).
export async function POST(req: Request) {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const form = await req.formData();
  const result = await performServerUpload({
    email,
    rawFiles: form.getAll("file").filter((f): f is File => f instanceof File),
    ttl: String(form.get("ttl") || ""),
    requestedSlug: String(form.get("slug") || "").trim(),
    requestedIndex: String(form.get("index") || "").trim(),
    viewersRaw: String(form.get("viewers") || ""),
    workspaceId: String(form.get("workspaceId") || "").trim() || null,
    visibilityRaw: String(form.get("visibility") || "allowlist"),
  });
  if ("error" in result) return result.error;

  const base = requestBase(req);
  return NextResponse.json({
    slug: result.site.slug,
    url: `${base}/s/${result.site.slug}`,
    pages: result.pages,
    version: result.version,
    republished: result.republished,
    expiresAt: new Date(result.site.expires_at).toISOString(),
  });
}
