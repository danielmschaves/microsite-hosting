import { serveSite } from "@/lib/siteServing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Path-based content serving. The actual logic (session gate, canViewSite,
// deployment_serving resolution, analytics, CSP headers) lives in
// lib/siteServing.ts, shared with the host-based route (CD-20,
// app/mbhost/[[...path]]/route.ts) so a {slug}.<apex> or custom-domain
// visitor gets byte-identical behavior to this URL.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string; path?: string[] }> },
) {
  const { slug, path } = await params;
  return serveSite(req, slug, path || []);
}
