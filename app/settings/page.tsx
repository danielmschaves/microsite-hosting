import { redirect } from "next/navigation";
import { Mail, Lock, Check } from "lucide-react";
import { auth, enabledProviders } from "@/auth";
import { query } from "@/lib/db";
import {
  FREE_SITE_LIMIT,
  FREE_STORAGE_BYTES,
  FREE_PLAN,
  allowedTtlPresets,
} from "@/lib/plan";
import { AppBar } from "@/components/AppBar";
import { SignOutButton } from "@/components/AuthButtons";
import { NewSiteDefaults } from "@/components/NewSiteDefaults";

export const dynamic = "force-dynamic";

function GoogleMark() {
  return (
    <span style={{ width: 34, height: 34, borderRadius: 9, background: "#fff", border: "1px solid rgba(0,0,0,.12)", display: "grid", placeItems: "center", flex: "none" }}>
      <span style={{ width: 18, height: 18, borderRadius: 5, background: "conic-gradient(from -45deg,#ea4335,#fbbc05,#34a853,#4285f4,#ea4335)", display: "grid", placeItems: "center", font: "800 11px/1 var(--font-ui)", color: "#fff" }}>
        G
      </span>
    </span>
  );
}
function GitHubMark() {
  return (
    <span style={{ width: 34, height: 34, borderRadius: 9, background: "var(--surface-3)", border: "1px solid var(--border-strong)", display: "grid", placeItems: "center", color: "var(--text)", flex: "none" }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.42c.58.11.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.56-.29-5.25-1.28-5.25-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.43-2.69 5.41-5.26 5.69.41.36.78 1.05.78 2.12v3.14c0 .31.21.68.8.56A11.5 11.5 0 0 0 12 .5Z" />
      </svg>
    </span>
  );
}

function initials(name: string | null | undefined, email: string): string {
  const base = (name || email).trim();
  const parts = base.split(/[\s@._-]+/).filter(Boolean);
  const chars = parts.length >= 2 ? parts[0][0] + parts[1][0] : base.slice(0, 2);
  return chars.toUpperCase();
}

export default async function SettingsPage() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) redirect("/");
  const name = session.user?.name;

  const rows = await query<{ size_bytes: string }>(
    "SELECT size_bytes FROM sites WHERE owner_email = $1 AND deleted_at IS NULL",
    [email],
  );
  const usedBytes = rows.reduce((s, r) => s + Number(r.size_bytes), 0);

  const connected = (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 11px", borderRadius: 999, background: "var(--success-soft)", border: "1px solid var(--success-border)", color: "var(--text)", font: "600 11px/1 var(--font-ui)", whiteSpace: "nowrap" }}>
      <Check size={12} style={{ color: "var(--success)" }} />
      Enabled
    </span>
  );
  const notConfigured = (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 11px", borderRadius: 999, background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text-subtle)", font: "600 11px/1 var(--font-ui)", whiteSpace: "nowrap" }}>
      Not configured
    </span>
  );

  return (
    <>
      <AppBar
        email={email}
        name={name}
        active="settings"
        usedBytes={usedBytes}
        siteCount={rows.length}
        siteLimit={FREE_SITE_LIMIT}
        storageLimitBytes={FREE_STORAGE_BYTES}
      />
      <div style={{ maxWidth: 780, margin: "0 auto", padding: "34px 30px 100px" }}>
        <h1 style={{ margin: "0 0 4px", font: "800 26px/1 var(--font-ui)", letterSpacing: "-.02em", color: "var(--text)" }}>
          Settings
        </h1>
        <p style={{ margin: "0 0 28px", font: "400 13.5px/1 var(--font-ui)", color: "var(--text-muted)" }}>
          Account, new-site defaults and sign-in providers.
        </p>

        {/* profile */}
        <div className="card" style={{ padding: 24, marginBottom: 18 }}>
          <div style={{ font: "700 15px/1 var(--font-ui)", color: "var(--text)", marginBottom: 18 }}>Profile</div>
          <div style={{ display: "flex", alignItems: "center", gap: 15 }}>
            <div style={{ width: 48, height: 48, borderRadius: 999, background: "linear-gradient(135deg,var(--accent),color-mix(in srgb,var(--accent) 40%,#000))", display: "grid", placeItems: "center", font: "700 17px/1 var(--font-ui)", color: "#fff", flex: "none" }}>
              {initials(name, email)}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              {name && <div style={{ font: "700 14.5px/1.2 var(--font-ui)", color: "var(--text)" }}>{name}</div>}
              <div style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 5, font: "500 12px/1 var(--font-mono)", color: "var(--text-muted)" }}>
                <Mail size={12} />
                {email}
              </div>
            </div>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 11px", borderRadius: 999, background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text-subtle)", font: "600 10.5px/1 var(--font-mono)", letterSpacing: ".06em", textTransform: "uppercase", whiteSpace: "nowrap" }}>
              <Lock size={11} />
              Managed by SSO
            </span>
          </div>
        </div>

        {/* connected accounts */}
        <div className="card" style={{ padding: 24, marginBottom: 18 }}>
          <div style={{ font: "700 15px/1 var(--font-ui)", color: "var(--text)", marginBottom: 5 }}>Sign-in providers</div>
          <div style={{ font: "400 12.5px/1.5 var(--font-ui)", color: "var(--text-muted)", marginBottom: 18 }}>
            Providers that authenticate you — and gate access to your sites.
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 13, padding: "13px 0", borderTop: "1px solid var(--border)" }}>
            <GoogleMark />
            <div style={{ flex: 1 }}>
              <div style={{ font: "600 13.5px/1.2 var(--font-ui)", color: "var(--text)" }}>Google</div>
              <div className="mb-mono" style={{ font: "500 11px/1 var(--font-mono)", color: "var(--text-subtle)", marginTop: 4 }}>
                OAuth sign-in
              </div>
            </div>
            {enabledProviders.google ? connected : notConfigured}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 13, padding: "13px 0", borderTop: "1px solid var(--border)" }}>
            <GitHubMark />
            <div style={{ flex: 1 }}>
              <div style={{ font: "600 13.5px/1.2 var(--font-ui)", color: "var(--text)" }}>GitHub</div>
              <div className="mb-mono" style={{ font: "500 11px/1 var(--font-mono)", color: "var(--text-subtle)", marginTop: 4 }}>
                OAuth sign-in
              </div>
            </div>
            {enabledProviders.github ? connected : notConfigured}
          </div>
        </div>

        {/* new-site defaults */}
        <NewSiteDefaults personalTtls={allowedTtlPresets(FREE_PLAN)} />

        {/* session */}
        <div className="card" style={{ padding: 24 }}>
          <div style={{ font: "700 15px/1 var(--font-ui)", color: "var(--text)", marginBottom: 5 }}>Session</div>
          <div style={{ font: "400 12.5px/1.5 var(--font-ui)", color: "var(--text-muted)", marginBottom: 18 }}>
            Sign out of MicroBuild on this device.
          </div>
          <SignOutButton variant="full" />
        </div>
      </div>
    </>
  );
}
