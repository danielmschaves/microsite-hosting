import { NextResponse, type NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Host-based routing (PRD v2.0 CD-20). Deliberately minimal and dependency-
// free — no database access, no Node-only APIs — so it stays on the
// standard Edge middleware runtime without any experimental config. Every
// request to this app's own canonical host(s) (NEXT_PUBLIC_BASE_URL /
// NEXTAUTH_URL's hostname, plus localhost for local dev) passes straight
// through unmodified: `/`, `/dashboard`, `/s/{slug}`, `/api/**` all keep
// working exactly as before — CD-20's gate is "no existing link changes
// behaviour," and this is how that's guaranteed rather than merely hoped for.
//
// Any OTHER host — a {slug}.<apex> / {deploymentId}.<previewApex> synthetic
// subdomain (only active when MICROBUILD_APEX_DOMAIN / _PREVIEW_APEX_DOMAIN
// are configured — unset by default, since this deployment doesn't own any
// particular domain out of the box) or a verified custom domain (CD-21) — is
// rewritten to /mbhost/*, a plain nodejs-runtime route handler that does the
// actual (database-backed) resolution. Keeping that lookup out of middleware
// is a deliberate simplicity/latency trade-off for this first cut, not a
// hard technical requirement — see app/mbhost/[[...path]]/route.ts. (Named
// "mbhost", not "_host": Next.js treats any app/_foo folder as a private,
// unroutable segment, which would silently make this whole route
// unreachable — confirmed the hard way against a real build.)
// ---------------------------------------------------------------------------

function canonicalHosts(): Set<string> {
  const hosts = new Set<string>(["localhost", "127.0.0.1"]);
  for (const envVar of [process.env.NEXT_PUBLIC_BASE_URL, process.env.NEXTAUTH_URL]) {
    if (!envVar) continue;
    try {
      hosts.add(new URL(envVar).hostname);
    } catch {
      // malformed env value — ignore, canonicalHosts() just won't include it
    }
  }
  return hosts;
}

const CANONICAL_HOSTS = canonicalHosts();

export function middleware(req: NextRequest): NextResponse {
  const host = (req.headers.get("host") || "").split(":")[0].toLowerCase();

  if (!host || CANONICAL_HOSTS.has(host)) {
    return NextResponse.next();
  }

  const url = req.nextUrl.clone();
  url.pathname = `/mbhost${url.pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  // Never rewrite Next's own asset/image pipeline or the operator-facing API
  // — a request to those must always hit the app's own routes regardless of
  // which host it arrived on (webhooks in particular must not depend on the
  // caller sending a "canonical" Host header).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/).*)"],
};
