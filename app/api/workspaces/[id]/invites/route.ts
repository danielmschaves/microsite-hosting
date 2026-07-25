import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireWorkspaceRole, isRole, getMembership } from "@/lib/teams";
import { sendEmail, inviteEmail } from "@/lib/email";
import { track } from "@/lib/events";

export const runtime = "nodejs";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const INVITE_DAYS = 14;

// GET — admin+: pending (unaccepted, unexpired) invites.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const res = await requireWorkspaceRole(id, "admin");
  if ("error" in res) return res.error;

  const rows = await query<{
    id: string;
    email: string;
    role: string;
    invited_by: string;
    expires_at: Date;
  }>(
    `SELECT id, email, role, invited_by, expires_at FROM workspace_invites
      WHERE workspace_id = $1 AND accepted_at IS NULL AND expires_at > now()
      ORDER BY created_at DESC`,
    [id],
  );
  return NextResponse.json({
    invites: rows.map((r) => ({
      id: r.id,
      email: r.email,
      role: r.role,
      invitedBy: r.invited_by,
      expiresAt: new Date(r.expires_at).toISOString(),
    })),
  });
}

// POST — admin+: { email, role? } create an invite; emails it when configured.
// Always returns the invite URL so the UI can offer copy-link (email is a
// convenience, never a dependency).
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const res = await requireWorkspaceRole(id, "admin");
  if ("error" in res) return res.error;
  const { workspace, email: actor } = res;

  const body = await req.json().catch(() => ({}));
  const invitee = String(body?.email || "").trim().toLowerCase();
  const role = body?.role ? String(body.role) : "member";
  if (!EMAIL_RE.test(invitee)) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }
  if (!isRole(role) || role === "owner") {
    return NextResponse.json(
      { error: "role must be 'admin' or 'member'" },
      { status: 400 },
    );
  }
  if (await getMembership(invitee, id)) {
    return NextResponse.json({ error: "Already a member" }, { status: 409 });
  }

  // Re-inviting replaces any previous pending invite for the same email.
  await query(
    "DELETE FROM workspace_invites WHERE workspace_id = $1 AND email = $2 AND accepted_at IS NULL",
    [id, invitee],
  );

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 24 * 3600 * 1000);
  await query(
    `INSERT INTO workspace_invites (workspace_id, email, role, token, invited_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, invitee, role, token, actor, expiresAt],
  );

  const base = process.env.NEXT_PUBLIC_BASE_URL || new URL(req.url).origin;
  const inviteUrl = `${base}/invite/${token}`;
  const { sent } = await sendEmail({
    to: invitee,
    ...inviteEmail({ workspaceName: workspace.name, invitedBy: actor, inviteUrl }),
  });

  await track("member_invited", {
    workspaceId: id,
    actor,
    meta: { invitee, role, emailSent: sent },
  });
  return NextResponse.json({ ok: true, inviteUrl, emailSent: sent });
}

// DELETE — admin+: { inviteId } revoke a pending invite.
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const res = await requireWorkspaceRole(id, "admin");
  if ("error" in res) return res.error;

  const body = await req.json().catch(() => ({}));
  const inviteId = String(body?.inviteId || "");
  if (!inviteId) {
    return NextResponse.json({ error: "inviteId required" }, { status: 400 });
  }
  await query(
    "DELETE FROM workspace_invites WHERE id = $1 AND workspace_id = $2 AND accepted_at IS NULL",
    [inviteId, id],
  ).catch(() => []);
  return NextResponse.json({ ok: true });
}
