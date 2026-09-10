import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { claimGuestSites, GUEST_TOKEN_COOKIE } from "@/lib/guestPublish";
import { parseCookies } from "@/lib/previewAccess";

export const runtime = "nodejs";

interface ClaimBody {
  trialId?: string;
}

// POST /api/guest/claim — session-required. Backs /claim: reads the
// mb_guest_token cookie, claims every unclaimed unexpired guest_sites row it
// matches (optionally scoped to one trialId), transfers ownership to the
// caller, and extends the TTL to 7d.
export async function POST(req: Request) {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const guestToken = parseCookies(req.headers.get("cookie"))[GUEST_TOKEN_COOKIE] ?? null;
  if (!guestToken) {
    return NextResponse.json({ claimed: [], message: "No trial sites found in this browser." });
  }

  const body: ClaimBody = await req.json().catch(() => ({}));
  const claimed = await claimGuestSites({ guestToken, claimedBy: email, trialId: body.trialId });

  return NextResponse.json({ claimed });
}
