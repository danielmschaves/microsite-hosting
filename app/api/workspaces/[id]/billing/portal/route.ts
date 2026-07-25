import { NextResponse } from "next/server";
import { requestBase } from "@/lib/url";
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

  const base = requestBase(req);
  const url = await createPortalSession(res.workspace, `${base}/teams/${id}`);
  return NextResponse.json({ url });
}
