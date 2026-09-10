import { NextResponse } from "next/server";
import { isFlagEnabled } from "@/lib/flags";
import { requireAgentScope } from "@/lib/agentAuthz";
import { claimGuestSites } from "@/lib/guestPublish";
import { badRequest } from "@/lib/agentErrors";

export const runtime = "nodejs";

interface ClaimBody {
  guestToken?: string;
  trialId?: string;
}

// POST /api/agent/guest/claim — claim_trial_site (site:write). An agent
// acting on its human's behalf post-signup: the agent holds the raw guest
// token (e.g. handed to it by the human, or read from the browser session it
// drove), and claims the trial site(s) to the token's granted_by email —
// the same human who authorized this agent token, not the workspace itself
// (guest sites stay personal on claim here, exactly like the session-based
// /claim flow).
export async function POST(req: Request) {
  if (!(await isFlagEnabled("agent_gateway"))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const authRes = await requireAgentScope(req, "site:write", { rateLimitKind: "write" });
  if ("error" in authRes) return authRes.error;

  const body: ClaimBody = await req.json().catch(() => ({}));
  if (!body.guestToken) {
    return badRequest("Provide guestToken");
  }

  const claimed = await claimGuestSites({
    guestToken: body.guestToken,
    claimedBy: authRes.email,
    trialId: body.trialId,
  });

  return NextResponse.json({ claimed });
}
