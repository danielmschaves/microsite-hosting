import { redirect } from "next/navigation";
import { ShieldCheck, Users, Clock } from "lucide-react";
import { auth } from "@/auth";
import { query } from "@/lib/db";
import { AcceptInvite } from "@/components/AcceptInvite";

export const dynamic = "force-dynamic";

interface InviteJoin {
  token: string;
  email: string;
  role: string;
  expires_at: Date;
  accepted_at: Date | null;
  workspace_name: string;
}

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/invite/${token}`)}`);
  }

  const rows = await query<InviteJoin>(
    `SELECT i.token, i.email, i.role, i.expires_at, i.accepted_at, w.name AS workspace_name
       FROM workspace_invites i JOIN workspaces w ON w.id = i.workspace_id
      WHERE i.token = $1`,
    [token],
  );
  const invite = rows[0];

  let state: "ok" | "gone" | "expired" | "wrong_email" = "ok";
  if (!invite || invite.accepted_at) state = "gone";
  else if (new Date(invite.expires_at).getTime() <= Date.now()) state = "expired";
  else if (invite.email.toLowerCase() !== email) state = "wrong_email";

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "40px 22px",
        background:
          "radial-gradient(130% 90% at 50% -10%, var(--accent-soft), transparent 55%)",
      }}
    >
      <div style={{ width: "100%", maxWidth: 414 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 26 }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: "var(--accent-soft)", border: "1px solid var(--accent-border)", display: "grid", placeItems: "center", color: "var(--accent)" }}>
            <ShieldCheck size={16} />
          </div>
          <span style={{ font: "800 16px/1 var(--font-ui)", letterSpacing: "-.02em", color: "var(--text)" }}>
            MicroBuild
          </span>
        </div>

        <div className="card" style={{ borderColor: "var(--border-strong)", padding: "36px 34px", boxShadow: "var(--shadow-3)", textAlign: "center" }}>
          <div style={{ width: 64, height: 64, margin: "0 auto 22px", borderRadius: 17, background: "var(--accent-soft)", border: "1px solid var(--accent-border)", display: "grid", placeItems: "center", color: "var(--accent)" }}>
            {state === "expired" ? <Clock size={30} /> : <Users size={30} />}
          </div>

          {state === "ok" && (
            <>
              <h1 style={{ margin: "0 0 10px", font: "800 22px/1.2 var(--font-ui)", letterSpacing: "-.02em", color: "var(--text)" }}>
                Join {invite.workspace_name}
              </h1>
              <p style={{ margin: "0 0 24px", font: "400 13.5px/1.55 var(--font-ui)", color: "var(--text-muted)" }}>
                You&apos;ve been invited as <strong style={{ color: "var(--text)" }}>{invite.role}</strong>.
                Team sites in this workspace become visible to you.
              </p>
              <AcceptInvite token={token} />
            </>
          )}
          {state === "gone" && (
            <>
              <h1 style={{ margin: "0 0 10px", font: "800 22px/1.2 var(--font-ui)", color: "var(--text)" }}>
                Invite not found
              </h1>
              <p style={{ margin: 0, font: "400 13.5px/1.55 var(--font-ui)", color: "var(--text-muted)" }}>
                This invite was already used or revoked. Ask a workspace admin for a new one.
              </p>
            </>
          )}
          {state === "expired" && (
            <>
              <h1 style={{ margin: "0 0 10px", font: "800 22px/1.2 var(--font-ui)", color: "var(--text)" }}>
                Invite expired
              </h1>
              <p style={{ margin: 0, font: "400 13.5px/1.55 var(--font-ui)", color: "var(--text-muted)" }}>
                Invites last 14 days. Ask a workspace admin to send a fresh one.
              </p>
            </>
          )}
          {state === "wrong_email" && (
            <>
              <h1 style={{ margin: "0 0 10px", font: "800 22px/1.2 var(--font-ui)", color: "var(--text)" }}>
                Wrong account
              </h1>
              <p style={{ margin: 0, font: "400 13.5px/1.55 var(--font-ui)", color: "var(--text-muted)" }}>
                This invite was sent to{" "}
                <span className="mb-mono" style={{ color: "var(--text)" }}>{invite.email}</span>, but
                you&apos;re signed in as{" "}
                <span className="mb-mono" style={{ color: "var(--text)" }}>{email}</span>. Sign out and
                back in with the invited account.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
