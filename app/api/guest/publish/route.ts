import { NextResponse } from "next/server";
import {
  publishGuestSite,
  checkGuestPublishRateLimit,
  GUEST_TOKEN_COOKIE,
  GUEST_TOKEN_MAX_AGE_SECONDS,
} from "@/lib/guestPublish";
import { getClientIp } from "@/lib/requestIp";
import { requestBase } from "@/lib/url";
import { parseCookies } from "@/lib/previewAccess";

export const runtime = "nodejs";

// POST /api/guest/publish — anonymous, no session required. Backs /try.
// Single .html file, 5MB cap, fixed 24h TTL + public visibility, 3/IP/hour.
// The guest cookie is intentionally non-unique per site: one browser can
// accumulate multiple trial sites (up to the rate cap) before claiming them
// all at once from /claim.
export async function POST(req: Request) {
  const ip = getClientIp(req);
  const rl = await checkGuestPublishRateLimit(ip);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited", message: "Too many trial publishes from this network. Try again later." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
    );
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Provide a single .html file as \"file\"" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const existingGuestToken = parseCookies(req.headers.get("cookie"))[GUEST_TOKEN_COOKIE] ?? null;

  const result = await publishGuestSite({
    filename: file.name,
    content: buffer,
    ip,
    existingGuestToken,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const base = requestBase(req);
  const res = NextResponse.json({
    ok: true,
    slug: result.site.slug,
    url: `${base}/s/${result.site.slug}`,
    expiresAt: new Date(result.site.expires_at).toISOString(),
    trialId: result.trialId,
  });
  res.cookies.set(GUEST_TOKEN_COOKIE, result.guestToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: GUEST_TOKEN_MAX_AGE_SECONDS,
    path: "/",
  });
  return res;
}
