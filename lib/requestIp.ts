/**
 * Best-effort client IP for guest-publish rate limiting (CD-18). Reads only
 * the first hop of X-Forwarded-For — correct behind a single reverse proxy
 * (Vercel, most PaaS setups), falls back to "unknown" (one shared bucket)
 * when there is no proxy in front at all, which is true for a bare
 * `docker compose up`. That's an explicit, documented dev-only limitation,
 * not a production posture — see CLAUDE.md's Agent Gateway risk notes.
 */
export function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}
