/**
 * The public base URL for the current request, derived from forwarded/host
 * headers (correct on localhost, docker and Vercel alike). The standalone
 * server's req.url origin reflects its bind address (0.0.0.0), so headers are
 * the source of truth here.
 */
export function requestBase(req: Request): string {
  const host =
    req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host) {
    const proto =
      req.headers.get("x-forwarded-proto") ??
      (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
    return `${proto}://${host}`;
  }
  return new URL(req.url).origin;
}
