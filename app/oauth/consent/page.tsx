import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getOAuthRequest, isExpired } from "@/lib/agentOAuth";
import { getWorkspacesFor } from "@/lib/teams";
import { ConsentPanel } from "@/components/ConsentPanel";

export const dynamic = "force-dynamic";

// DS-04's screen: workspace picker, every requested scope in plain language,
// expiry, Allow/Deny. Built entirely from existing design-system primitives
// (.card, .btn-primary/.btn-ghost, Pill, Banner) — no new tokens needed.
export default async function OAuthConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ requestId?: string }>;
}) {
  const { requestId } = await searchParams;
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/oauth/consent?requestId=${requestId || ""}`)}`);
  }

  if (!requestId) {
    return <ConsentError message="Missing request. Ask the agent to restart the sign-in flow." />;
  }
  const oauthRequest = await getOAuthRequest(requestId);
  if (!oauthRequest || oauthRequest.status !== "pending") {
    return <ConsentError message="This authorization request is no longer pending. Ask the agent to restart the sign-in flow." />;
  }
  if (isExpired(oauthRequest)) {
    return <ConsentError message="This authorization request expired. Ask the agent to restart the sign-in flow." />;
  }

  const workspaces = await getWorkspacesFor(email!);

  return (
    <ConsentPanel
      requestId={oauthRequest.id}
      clientName={oauthRequest.client_name}
      clientKind={oauthRequest.client_kind}
      scopes={oauthRequest.requested_scopes}
      expiresAt={new Date(oauthRequest.expires_at).toISOString()}
      workspaces={workspaces.map((w) => ({ id: w.id, name: w.name }))}
    />
  );
}

function ConsentError({ message }: { message: string }) {
  return (
    <div style={{ maxWidth: 480, margin: "80px auto", padding: "0 20px" }}>
      <div className="card" style={{ padding: 24 }}>
        <div style={{ font: "700 16px/1.3 var(--font-ui)", color: "var(--text)", marginBottom: 8 }}>
          Can&apos;t continue
        </div>
        <div style={{ font: "400 13.5px/1.5 var(--font-ui)", color: "var(--text-muted)" }}>{message}</div>
      </div>
    </div>
  );
}
