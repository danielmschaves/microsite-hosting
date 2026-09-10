import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

// Device-code verification landing page: a human types (or arrives with) the
// short user_code an agent printed to its terminal, and is forwarded to the
// same consent screen the auth-code flow uses.
export default async function OAuthDevicePage({
  searchParams,
}: {
  searchParams: Promise<{ user_code?: string }>;
}) {
  const { user_code } = await searchParams;
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/oauth/device${user_code ? `?user_code=${user_code}` : ""}`)}`);
  }

  if (user_code) {
    const rows = await query<{ id: string }>(
      `SELECT id FROM agent_oauth_requests
        WHERE user_code = $1 AND flow = 'device_code' AND status = 'pending' AND expires_at > now()`,
      [user_code.trim().toUpperCase()],
    );
    if (rows[0]) {
      redirect(`/oauth/consent?requestId=${rows[0].id}`);
    }
  }

  return (
    <div style={{ maxWidth: 400, margin: "80px auto", padding: "0 20px" }}>
      <div className="card" style={{ padding: 24 }}>
        <div style={{ font: "700 16px/1.3 var(--font-ui)", color: "var(--text)", marginBottom: 8 }}>
          Connect an agent
        </div>
        <div style={{ font: "400 13.5px/1.5 var(--font-ui)", color: "var(--text-muted)", marginBottom: 16 }}>
          Enter the code shown in your terminal.
        </div>
        <form>
          <input
            name="user_code"
            defaultValue={user_code || ""}
            placeholder="XXXX-XXXX"
            className="field mb-mono"
            style={{ width: "100%", textTransform: "uppercase", letterSpacing: "0.1em" }}
            autoFocus
          />
          <button type="submit" className="btn btn-primary" style={{ marginTop: 12, width: "100%" }}>
            Continue
          </button>
        </form>
      </div>
    </div>
  );
}
