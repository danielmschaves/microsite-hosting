import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { query } from "@/lib/db";
import { requireWorkspaceRole, isRole } from "@/lib/teams";
import { track } from "@/lib/events";

export const runtime = "nodejs";

// GET — member+: list members with roles.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const res = await requireWorkspaceRole(id, "member");
  if ("error" in res) return res.error;

  const rows = await query<{ email: string; role: string; joined_at: Date }>(
    `SELECT email, role, joined_at FROM workspace_members
      WHERE workspace_id = $1
      ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, email`,
    [id],
  );
  return NextResponse.json({
    members: rows.map((r) => ({
      email: r.email,
      role: r.role,
      joinedAt: new Date(r.joined_at).toISOString(),
    })),
  });
}

// PATCH — owner only: { email, role } change a member's role (admin <-> member).
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const res = await requireWorkspaceRole(id, "owner");
  if ("error" in res) return res.error;

  const body = await req.json().catch(() => ({}));
  const target = String(body?.email || "").trim().toLowerCase();
  const role = String(body?.role || "");
  if (!target || !isRole(role) || role === "owner") {
    return NextResponse.json(
      { error: "Provide { email, role: 'admin' | 'member' }" },
      { status: 400 },
    );
  }
  if (target === res.email) {
    return NextResponse.json(
      { error: "The owner's role cannot be changed" },
      { status: 400 },
    );
  }

  const updated = await query(
    `UPDATE workspace_members SET role = $1
      WHERE workspace_id = $2 AND email = $3 AND role <> 'owner'
      RETURNING email`,
    [role, id, target],
  );
  if (updated.length === 0) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }
  await track("member_role_changed", {
    workspaceId: id,
    actor: res.email,
    meta: { member: target, role },
  });
  return NextResponse.json({ ok: true });
}

// DELETE — { email }: admin+ removes a member, or any member removes themself
// (leave). The owner can never be removed and cannot leave.
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await auth();
  const caller = session?.user?.email?.toLowerCase();
  if (!caller) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const target = String(body?.email || "").trim().toLowerCase();
  if (!target) {
    return NextResponse.json({ error: "email required" }, { status: 400 });
  }

  const isSelf = target === caller;
  // Self-leave needs only membership; removing others needs admin+.
  const res = await requireWorkspaceRole(id, isSelf ? "member" : "admin");
  if ("error" in res) return res.error;

  const removed = await query(
    `DELETE FROM workspace_members
      WHERE workspace_id = $1 AND email = $2 AND role <> 'owner'
      RETURNING email`,
    [id, target],
  );
  if (removed.length === 0) {
    return NextResponse.json(
      { error: "Member not found (the owner cannot be removed)" },
      { status: 404 },
    );
  }
  await track("member_removed", {
    workspaceId: id,
    actor: caller,
    meta: { member: target, self: isSelf },
  });

  // Seat sync (Phase 3): updateSeatQuantity is wired here once billing lands.
  return NextResponse.json({ ok: true });
}
