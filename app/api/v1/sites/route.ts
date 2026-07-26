import { NextResponse } from "next/server";
import { requestBase } from "@/lib/url";
import { query } from "@/lib/db";
import { requireApiAuth } from "@/lib/apiTokens";
import { performServerUpload } from "@/lib/uploadService";

export const runtime = "nodejs";

// Token-authenticated REST v1. All endpoints are owner-scoped: a token acts
// as its owner and never sees anyone else's sites.

// GET /api/v1/sites — list your live sites.
export async function GET(req: Request) {
  const authRes = await requireApiAuth(req);
  if ("error" in authRes) return authRes.error;

  const rows = await query<{
    slug: string;
    size_bytes: string;
    page_count: number;
    ttl_preset: string;
    visibility: string;
    current_version: number;
    expires_at: Date;
    created_at: Date;
  }>(
    `SELECT slug, size_bytes, page_count, ttl_preset, visibility, current_version,
            expires_at, created_at
       FROM sites
      WHERE lower(owner_email) = $1 AND deleted_at IS NULL
      ORDER BY created_at DESC`,
    [authRes.email.toLowerCase()],
  );
  const base = requestBase(req);
  return NextResponse.json({
    sites: rows.map((r) => ({
      slug: r.slug,
      url: `${base}/s/${r.slug}`,
      sizeBytes: Number(r.size_bytes),
      pages: Number(r.page_count),
      ttl: r.ttl_preset,
      visibility: r.visibility,
      version: Number(r.current_version),
      expiresAt: new Date(r.expires_at).toISOString(),
      createdAt: new Date(r.created_at).toISOString(),
    })),
  });
}

// POST /api/v1/sites — multipart/form-data: `file` fields (repeatable) plus
// ttl, slug?, index?, visibility?, viewers?. Re-using your own live slug
// publishes a new version at the same URL.
export async function POST(req: Request) {
  const authRes = await requireApiAuth(req);
  if ("error" in authRes) return authRes.error;

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
    ttl: String(form.get("ttl") || ""),
    requestedSlug: String(form.get("slug") || "").trim(),
    requestedIndex: String(form.get("index") || "").trim(),
    viewersRaw: String(form.get("viewers") || ""),
    workspaceId: String(form.get("workspaceId") || "").trim() || null,
    visibilityRaw: String(form.get("visibility") || "allowlist"),
  });
  if ("error" in result) return result.error;

  const base = requestBase(req);
  return NextResponse.json(
    {
      slug: result.site.slug,
      url: `${base}/s/${result.site.slug}`,
      pages: result.pages,
      version: result.version,
      republished: result.republished,
      expiresAt: new Date(result.site.expires_at).toISOString(),
    },
    { status: result.republished ? 200 : 201 },
  );
}
