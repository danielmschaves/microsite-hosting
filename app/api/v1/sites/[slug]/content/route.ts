import { NextResponse } from "next/server";
import { requestBase } from "@/lib/url";
import { query, type SiteRow } from "@/lib/db";
import { requireApiAuth } from "@/lib/apiTokens";
import { performServerUpload } from "@/lib/uploadService";

export const runtime = "nodejs";

// PUT /api/v1/sites/{slug}/content — multipart files only; always publishes
// a new version of an existing owned site (404 otherwise). TTL optionally
// overridable via a `ttl` field; defaults to the site's current preset
// (countdown resets either way).
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const authRes = await requireApiAuth(req);
  if ("error" in authRes) return authRes.error;
  const { slug } = await params;

  const rows = await query<SiteRow>(
    "SELECT * FROM sites WHERE slug = $1 AND deleted_at IS NULL",
    [slug],
  );
  const site = rows[0];
  if (!site || site.owner_email.toLowerCase() !== authRes.email.toLowerCase()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json(
      { error: "Send multipart/form-data with one or more `file` fields" },
      { status: 400 },
    );
  }

  const result = await performServerUpload({
    email: authRes.email,
    rawFiles: form.getAll("file").filter((f): f is File => f instanceof File),
    ttl: String(form.get("ttl") || site.ttl_preset),
    requestedSlug: slug,
    requestedIndex: String(form.get("index") || "").trim(),
    viewersRaw: "",
    workspaceId: null,
    visibilityRaw: "allowlist", // ignored in update mode
    requireExisting: true,
  });
  if ("error" in result) return result.error;

  const base = requestBase(req);
  return NextResponse.json({
    slug: result.site.slug,
    url: `${base}/s/${result.site.slug}`,
    pages: result.pages,
    version: result.version,
    expiresAt: new Date(result.site.expires_at).toISOString(),
  });
}
