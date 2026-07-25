import { NextResponse } from "next/server";
import { requireWorkspaceRole } from "@/lib/teams";
import { billingEnabled } from "@/lib/plan";
import { createPortalSession } from "@/lib/billing";

export const runtime = "nodejs";

// POST — owner: open the Stripe customer portal. Returns { url }.
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

  const base = process.env.NEXT_PUBLIC_BASE_URL || new URL(req.url).origin;
  const url = await createPortalSession(res.workspace, `${base}/teams/${id}`);
  return NextResponse.json({ url });
}
