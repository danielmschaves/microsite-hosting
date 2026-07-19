import { redirect } from "next/navigation";
import { ShieldCheck, LockKeyhole, EyeOff, Timer, Users } from "lucide-react";
import { auth, enabledProviders } from "@/auth";
import { ProviderSignIn } from "@/components/AuthButtons";
import { ThemeToggle } from "@/components/ThemeToggle";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await auth();
  if (session?.user) redirect("/dashboard");

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

      <div style={{ width: "100%", maxWidth: 460 }}>
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
          style={{
            borderColor: "var(--border-strong)",
            padding: "36px 34px",
            boxShadow: "var(--shadow-3)",
            textAlign: "center",
          }}
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
            Private by default
          </div>
          <h1 style={{ margin: "0 0 10px", font: "800 23px/1.15 var(--font-ui)", letterSpacing: "-.02em", color: "var(--text)" }}>
            Ship an HTML file. Get a private link.
          </h1>
          <p style={{ margin: "0 0 22px", font: "400 13.5px/1.55 var(--font-ui)", color: "var(--text-muted)" }}>
            Sign in to publish a self-contained page behind SSO, share the link, and
            let it expire on your schedule.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {enabledProviders.google && <ProviderSignIn provider="google" />}
            {enabledProviders.github && <ProviderSignIn provider="github" />}
            {!enabledProviders.google && !enabledProviders.github && (
              <div
                style={{
                  padding: "10px 12px",
                  borderRadius: "var(--r-md)",
                  background: "var(--danger-soft)",
                  border: "1px solid var(--danger-border)",
                  color: "var(--text)",
                  font: "500 12.5px/1.5 var(--font-ui)",
                }}
              >
                No OAuth providers configured. Set AUTH_GOOGLE_ID / AUTH_GITHUB_ID
                (and secrets) in your environment.
              </div>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "20px 0" }}>
            <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
            <span style={{ font: "500 10.5px/1 var(--font-mono)", color: "var(--text-subtle)" }}>
              SSO-GATED · AUTO-EXPIRING
            </span>
            <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
          </div>

          <div style={{ display: "flex", justifyContent: "center", gap: 18, color: "var(--text-subtle)" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, font: "500 11px/1 var(--font-mono)" }}>
              <Users size={12} /> Allowlisted
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, font: "500 11px/1 var(--font-mono)" }}>
              <Timer size={12} /> Self-destructs
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
