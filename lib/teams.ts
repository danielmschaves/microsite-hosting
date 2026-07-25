import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { query, type WorkspaceRow } from "./db";

export type Role = "owner" | "admin" | "member";

const RANK: Record<Role, number> = { member: 1, admin: 2, owner: 3 };

export function roleAtLeast(role: Role, min: Role): boolean {
  return RANK[role] >= RANK[min];
}

export function isRole(value: string): value is Role {
  return value === "owner" || value === "admin" || value === "member";
}

/** The caller's role in a workspace, or null if not a member. */
export async function getMembership(
  email: string,
  workspaceId: string,
): Promise<Role | null> {
  const rows = await query<{ role: Role }>(
    "SELECT role FROM workspace_members WHERE workspace_id = $1 AND email = $2",
    [workspaceId, email.toLowerCase()],
  );
  return rows[0]?.role ?? null;
}

export interface WorkspaceWithRole extends WorkspaceRow {
  my_role: Role;
  member_count: number;
}

/** All workspaces the user belongs to, with their role and member count. */
export async function getWorkspacesFor(
  email: string,
): Promise<WorkspaceWithRole[]> {
  return query<WorkspaceWithRole>(
    `SELECT w.*, m.role AS my_role,
            (SELECT count(*) FROM workspace_members mm WHERE mm.workspace_id = w.id)::int AS member_count
       FROM workspaces w
       JOIN workspace_members m ON m.workspace_id = w.id AND m.email = $1
      ORDER BY w.created_at`,
    [email.toLowerCase()],
  );
}

/**
 * Route-handler guard: load the workspace and require the session user to hold
 * at least `minRole`. Mirrors the shape of the sites `authorize()` helper so
 * routes read identically.
 */
export async function requireWorkspaceRole(
  workspaceId: string,
  minRole: Role,
): Promise<
  | { workspace: WorkspaceRow; email: string; role: Role }
  | { error: NextResponse }
> {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  let rows: WorkspaceRow[] = [];
  try {
    rows = await query<WorkspaceRow>("SELECT * FROM workspaces WHERE id = $1", [
      workspaceId,
    ]);
  } catch {
    // invalid uuid input
  }
  const workspace = rows[0];
  if (!workspace) {
    return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }
  const role = await getMembership(email, workspaceId);
  if (!role) {
    // Hide existence from non-members.
    return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }
  if (!roleAtLeast(role, minRole)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { workspace, email, role };
}
