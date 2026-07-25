import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { query, type WorkspaceRow } from "@/lib/db";
import { getMembership } from "@/lib/teams";
import { updateSeatQuantity } from "@/lib/billing";
import { track } from "@/lib/events";

export const runtime = "nodejs";

interface InviteRow {
  id: string;
  workspace_id: string;
  email: string;
  role: string;
  expires_at: Date;
  accepted_at: Date | null;
}

// POST — accept an invite. The session email must match the invited email
// (invites are bound to the address they were sent to). Idempotent for
// already-joined members.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await query<InviteRow>(
    "SELECT * FROM workspace_invites WHERE token = $1",
    [token],
  );
  const invite = rows[0];
  if (!invite || invite.accepted_at) {
    return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  }
  if (new Date(invite.expires_at).getTime() <= Date.now()) {
    return NextResponse.json({ error: "Invite has expired" }, { status: 410 });
  }
  if (invite.email.toLowerCase() !== email) {
    return NextResponse.json(
      { error: `This invite was sent to ${invite.email}. Sign in with that account to accept it.` },
      { status: 403 },
    );
  }

  if (await getMembership(email, invite.workspace_id)) {
    // Already a member — just consume the invite.
    await query("UPDATE workspace_invites SET accepted_at = now() WHERE id = $1", [
      invite.id,
    ]);
    return NextResponse.json({ ok: true, workspaceId: invite.workspace_id });
  }

  await query(
    `INSERT INTO workspace_members (workspace_id, email, role)
     VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [invite.workspace_id, email, invite.role],
  );
  await query("UPDATE workspace_invites SET accepted_at = now() WHERE id = $1", [
    invite.id,
  ]);
  await track("member_joined", {
    workspaceId: invite.workspace_id,
    actor: email,
    meta: { role: invite.role },
  });

  // Seat sync: never blocks the join; webhook reconciles later.
  const ws = await query<WorkspaceRow>("SELECT * FROM workspaces WHERE id = $1", [
    invite.workspace_id,
  ]);
  if (ws[0]) {
    const count = await query<{ count: string }>(
      "SELECT count(*) FROM workspace_members WHERE workspace_id = $1",
      [invite.workspace_id],
    );
    await updateSeatQuantity(ws[0], Number(count[0].count));
  }

  return NextResponse.json({ ok: true, workspaceId: invite.workspace_id });
}
