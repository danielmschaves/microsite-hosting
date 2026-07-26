import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { query, type SiteRow } from "./db";
import { getMembership, roleAtLeast } from "./teams";

// Central authorization for sites. Every access decision lives here — the
// serving route, the manage APIs, and the pages all call these two functions.

export type Visibility = "only_me" | "allowlist" | "team" | "public";

export function isVisibility(value: string): value is Visibility {
  return (
    value === "only_me" ||
    value === "allowlist" ||
    value === "team" ||
    value === "public"
  );
}

/**
 * Can `email` view this site's content?
 * - owner: always
 * - only_me: owner only
 * - allowlist: owner + site_viewers entries
 * - team: owner + any member of the site's workspace
 * - public: anyone (the serving route also skips the login wall)
 */
export async function canViewSite(
  site: SiteRow,
  email: string,
): Promise<boolean> {
  const lower = email.toLowerCase();
  if (site.owner_email.toLowerCase() === lower) return true;

  switch (site.visibility) {
    case "only_me":
      return false;
    case "public":
      return true;
    case "team": {
      if (!site.workspace_id) return false;
      return (await getMembership(lower, site.workspace_id)) !== null;
    }
    case "allowlist":
    default: {
      const allowed = await query(
        "SELECT 1 FROM site_viewers WHERE site_id = $1 AND lower(viewer_email) = $2",
        [site.id, lower],
      );
      return allowed.length > 0;
    }
  }
}

export type ManagerRole = "owner" | "workspace_admin";

/**
 * Route-handler guard for site mutations. The site owner can always manage;
 * workspace admins/owners can manage sites in their workspace when
 * `allowWorkspaceAdmin` is set (admin powers: force-expire, trash).
 */
export async function authorizeSiteManage(
  id: string,
  opts: { allowWorkspaceAdmin?: boolean } = {},
): Promise<
  | { site: SiteRow; email: string; role: ManagerRole }
  | { error: NextResponse }
> {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  let rows: SiteRow[] = [];
  try {
    rows = await query<SiteRow>("SELECT * FROM sites WHERE id = $1", [id]);
  } catch {
    // invalid uuid input
  }
  const site = rows[0];
  if (!site || site.purged_at) {
    return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }
  if (site.owner_email.toLowerCase() === email) {
    return { site, email, role: "owner" };
  }
  if (opts.allowWorkspaceAdmin && site.workspace_id) {
    const membership = await getMembership(email, site.workspace_id);
    if (membership && roleAtLeast(membership, "admin")) {
      return { site, email, role: "workspace_admin" };
    }
  }
  return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
}
