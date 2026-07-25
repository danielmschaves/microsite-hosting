import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireWorkspaceRole } from "@/lib/teams";
import { billingEnabled } from "@/lib/plan";
import { createCheckoutSession } from "@/lib/billing";

export const runtime = "nodejs";

// POST — owner: start a Team-plan checkout. Returns { url } to redirect to.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const res = await requireWorkspaceRole(id, "owner");
  if ("error" in res) return res.error;

  if (!billingEnabled) {
    return NextResponse.json(
      { error: "Billing is not configured on this deployment" },
      { status: 503 },
    );
  }

  const members = await query<{ count: string }>(
    "SELECT count(*) FROM workspace_members WHERE workspace_id = $1",
    [id],
  );
  const base = process.env.NEXT_PUBLIC_BASE_URL || new URL(req.url).origin;
  const url = await createCheckoutSession(
    res.workspace,
    Number(members[0].count),
    `${base}/teams/${id}`,
  );
  return NextResponse.json({ url });
}
