import { NextResponse } from "next/server";
import { backfillDeployments, verifyAddressingParity } from "@/lib/backfillDeployments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One-time (idempotent, re-runnable) R0 backfill + verifier. Not part of the
// recurring cleanup cron — a one-time job re-firing on a TTL-sweep schedule
// is the wrong shape. Reuses CRON_SECRET (no new secret to provision).
//
//   POST /api/admin/backfill-deployments            — run the backfill
//   POST /api/admin/backfill-deployments?dryRun=true — report without writing
//   GET  /api/admin/backfill-deployments             — run the verifier only
async function checkAuth(req: Request): Promise<NextResponse | null> {
  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization") || "";
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export async function POST(req: Request) {
  const unauthorized = await checkAuth(req);
  if (unauthorized) return unauthorized;

  const dryRun = new URL(req.url).searchParams.get("dryRun") === "true";
  const backfill = await backfillDeployments({ dryRun });
  const parity = await verifyAddressingParity();
  return NextResponse.json({ backfill, parity });
}

export async function GET(req: Request) {
  const unauthorized = await checkAuth(req);
  if (unauthorized) return unauthorized;

  const parity = await verifyAddressingParity();
  return NextResponse.json({ parity });
}
