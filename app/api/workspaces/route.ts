import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { pool, query, type WorkspaceRow } from "@/lib/db";
import { getWorkspacesFor } from "@/lib/teams";
import { track } from "@/lib/events";

export const runtime = "nodejs";

// GET — the caller's workspaces with role + member count.
export async function GET() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const workspaces = await getWorkspacesFor(email);
  return NextResponse.json({
    workspaces: workspaces.map((w) => ({
      id: w.id,
      name: w.name,
      plan: w.plan,
      myRole: w.my_role,
      memberCount: w.member_count,
    })),
  });
}

// POST — create a workspace; creator becomes owner.
export async function POST(req: Request) {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const name = String(body?.name || "").trim();
  if (name.length < 2 || name.length > 80) {
    return NextResponse.json(
      { error: "Workspace name must be 2-80 characters" },
      { status: 400 },
    );
  }

  // Create workspace + owner membership atomically.
  const client = await pool.connect();
  let workspace: WorkspaceRow;
  try {
    await client.query("BEGIN");
    const res = await client.query<WorkspaceRow>(
      "INSERT INTO workspaces (name, created_by) VALUES ($1, $2) RETURNING *",
      [name, email],
    );
    workspace = res.rows[0];
    await client.query(
      "INSERT INTO workspace_members (workspace_id, email, role) VALUES ($1, $2, 'owner')",
      [workspace.id, email],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  await track("workspace_created", { workspaceId: workspace.id, actor: email });
  return NextResponse.json({ id: workspace.id, name: workspace.name });
}
