import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppBar } from "@/components/AppBar";
import { ClaimPanel } from "@/components/ClaimPanel";
import { FREE_SITE_LIMIT, FREE_STORAGE_BYTES } from "@/lib/plan";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

// /claim — session-gated. The actual claim call happens client-side
// (ClaimPanel) on mount, since it needs to read the mb_guest_token cookie
// the browser already holds from /try — nothing to look up server-side
// before the page renders.
export default async function ClaimPage() {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) redirect(`/?callbackUrl=${encodeURIComponent("/claim")}`);

  const mySites = await query<{ size_bytes: string }>(
    "SELECT size_bytes FROM sites WHERE owner_email = $1 AND deleted_at IS NULL",
    [email],
  );
  const usedBytes = mySites.reduce((s, r) => s + Number(r.size_bytes), 0);

  return (
    <>
      <AppBar
        email={email}
        name={session?.user?.name}
        active="sites"
        usedBytes={usedBytes}
        siteCount={mySites.length}
        siteLimit={FREE_SITE_LIMIT}
        storageLimitBytes={FREE_STORAGE_BYTES}
      />
      <div style={{ maxWidth: 560, margin: "0 auto", padding: "40px 24px 100px" }}>
        <h1 style={{ font: "800 24px/1 var(--font-ui)", color: "var(--text)" }}>Claim your trial sites</h1>
        <p style={{ font: "400 13.5px/1.5 var(--font-ui)", color: "var(--text-muted)", marginTop: 8, marginBottom: 24 }}>
          Anything you published anonymously from this browser at <code className="mb-mono">/try</code> gets
          transferred to your account and its expiry extended to 7 days.
        </p>
        <ClaimPanel />
      </div>
    </>
  );
}
