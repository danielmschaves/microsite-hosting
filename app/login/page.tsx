import { redirect } from "next/navigation";
import { ShieldCheck, LockKeyhole, EyeOff, Link2 } from "lucide-react";
import { auth, enabledProviders } from "@/auth";
import { ProviderSignIn } from "@/components/AuthButtons";
import { ThemeToggle } from "@/components/ThemeToggle";

export const dynamic = "force-dynamic";

export default async function LoginWall({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const { callbackUrl = "/dashboard", error } = await searchParams;

  const session = await auth();
  if (session?.user) redirect(callbackUrl);

  // Show the target site path if the viewer was gated on /s/{slug}.
  let sitePath: string | null = null;
  try {
    const p = decodeURIComponent(callbackUrl);
    if (p.startsWith("/s/")) sitePath = p;
  } catch {
    /* ignore */
  }

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
      <div style={{ position: "fixed", top: 18, right: 22 }}>
        <ThemeToggle />
      </div>

      <div style={{ width: "100%", maxWidth: 414 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 26 }}>
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: 8,
              background: "var(--accent-soft)",
              border: "1px solid var(--accent-border)",
              display: "grid",
              placeItems: "center",
              color: "var(--accent)",
            }}
          >
            <ShieldCheck size={16} />
          </div>
          <span style={{ font: "800 16px/1 var(--font-ui)", letterSpacing: "-.02em", color: "var(--text)" }}>
            MicroBuild
          </span>
        </div>

        <div
          className="card"
          style={{ borderColor: "var(--border-strong)", padding: "36px 34px", boxShadow: "var(--shadow-3)", textAlign: "center" }}
        >
          <div
            style={{
              width: 64,
              height: 64,
              margin: "0 auto 22px",
              borderRadius: 17,
              background: "var(--accent-soft)",
              border: "1px solid var(--accent-border)",
              display: "grid",
              placeItems: "center",
              color: "var(--accent)",
              boxShadow: "var(--glow-accent)",
            }}
          >
            <LockKeyhole size={31} />
          </div>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "5px 11px",
              borderRadius: 999,
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              color: "var(--text-muted)",
              font: "600 10.5px/1 var(--font-mono)",
              letterSpacing: ".08em",
              textTransform: "uppercase",
              marginBottom: 16,
            }}
          >
            <EyeOff size={11} />
            Private site
          </div>
          <h1 style={{ margin: "0 0 10px", font: "800 23px/1.15 var(--font-ui)", letterSpacing: "-.02em", color: "var(--text)" }}>
            Sign in to view this site
          </h1>

          {sitePath ? (
            <>
              <p style={{ margin: "0 0 6px", font: "400 13.5px/1.55 var(--font-ui)", color: "var(--text-muted)" }}>
                Access to
              </p>
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 7,
                  padding: "7px 13px",
                  borderRadius: 9,
                  background: "var(--surface-2)",
                  border: "1px solid var(--border-strong)",
                  marginBottom: 22,
                  maxWidth: "100%",
                }}
              >
                <Link2 size={13} style={{ color: "var(--text-subtle)", flex: "none" }} />
                <span
                  style={{
                    font: "600 12.5px/1 var(--font-mono)",
                    color: "var(--text)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {sitePath}
                </span>
              </div>
            </>
          ) : (
            <p style={{ margin: "0 0 22px", font: "400 13.5px/1.55 var(--font-ui)", color: "var(--text-muted)" }}>
              This link is private. Sign in to continue.
            </p>
          )}

          {error && (
            <div
              style={{
                padding: "9px 12px",
                borderRadius: "var(--r-md)",
                background: "var(--danger-soft)",
                border: "1px solid var(--danger-border)",
                color: "var(--text)",
                font: "500 12px/1.4 var(--font-ui)",
                marginBottom: 16,
              }}
            >
              Sign-in failed. Please try again.
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {enabledProviders.google && <ProviderSignIn provider="google" callbackUrl={callbackUrl} />}
            {enabledProviders.github && <ProviderSignIn provider="github" callbackUrl={callbackUrl} />}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "20px 0" }}>
            <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
            <span style={{ font: "500 10.5px/1 var(--font-mono)", color: "var(--text-subtle)" }}>
              ALLOWLIST-GATED
            </span>
            <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
          </div>
          <p style={{ margin: 0, font: "400 12px/1.55 var(--font-ui)", color: "var(--text-muted)" }}>
            Your email must be on this site&apos;s allowlist. Not on the list? Ask the
            owner to add you.
          </p>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            marginTop: 20,
            font: "500 11px/1.3 var(--font-mono)",
            color: "var(--text-subtle)",
          }}
        >
          <ShieldCheck size={13} />
          Protected by MicroBuild · access enforced server-side
        </div>
      </div>
    </div>
  );
}
