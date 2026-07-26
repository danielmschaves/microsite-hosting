import Link from "next/link";
import { auth } from "@/auth";
import { query } from "@/lib/db";
import {
  FREE_PLAN,
  TEAM_PLAN,
  FREE_SITE_LIMIT,
  FREE_STORAGE_BYTES,
  MIN_TEAM_SEATS,
} from "@/lib/plan";
import { AppBar } from "@/components/AppBar";
import { Check, Minus, Lock, ShieldCheck } from "lucide-react";

export const dynamic = "force-dynamic";

function mb(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

interface Feature {
  label: string;
  on: boolean;
}

const PLANS: {
  name: string;
  price: string;
  unit: string;
  blurb: string;
  cta: { label: string; href: string };
  highlight: boolean;
  tag?: string;
  features: Feature[];
}[] = [
  {
    name: "Free",
    price: "$0",
    unit: "forever",
    blurb: "Share a page behind a login wall in under a minute.",
    cta: { label: "Start publishing", href: "/upload" },
    highlight: false,
    features: [
      { label: `${FREE_PLAN.siteLimit} active sites`, on: true },
      { label: `${mb(FREE_PLAN.maxSiteBytes)} per site`, on: true },
      { label: `TTLs up to ${FREE_PLAN.maxTtl}`, on: true },
      { label: "Login wall + viewer allowlists", on: true },
      { label: "Public link mode", on: true },
      { label: "Version history & rollback", on: false },
      { label: "Team visibility & audit log", on: false },
    ],
  },
  {
    name: "Team",
    price: "$8",
    unit: `per seat / month · min ${MIN_TEAM_SEATS}`,
    blurb: "A shared workspace where internal links can just live.",
    cta: { label: "Upgrade a workspace", href: "/teams" },
    highlight: true,
    tag: "MOST POPULAR",
    features: [
      { label: `${TEAM_PLAN.siteLimit} active sites per workspace`, on: true },
      { label: `${mb(TEAM_PLAN.maxSiteBytes)} per site`, on: true },
      { label: `TTLs up to ${TEAM_PLAN.maxTtl} + max-TTL policy`, on: true },
      { label: "Everyone-at-team visibility", on: true },
      { label: `Last ${TEAM_PLAN.versionLimit} versions + instant rollback`, on: true },
      { label: `${TEAM_PLAN.auditDays}-day audit log`, on: true },
      { label: "REST API & access tokens", on: true },
    ],
  },
  {
    name: "Business",
    price: "Let's talk",
    unit: "annual",
    blurb: "Your IdP, your policies, your paper trail.",
    cta: { label: "Contact us", href: "mailto:sales@microbuild.app" },
    highlight: false,
    tag: "COMING SOON",
    features: [
      { label: "Everything in Team", on: true },
      { label: "Own-domain SSO (SAML 2.0 / OIDC)", on: true },
      { label: "SCIM provisioning", on: true },
      { label: "Extended audit retention", on: true },
      { label: "Regional data residency", on: true },
      { label: "Priority support", on: true },
      { label: "Invoiced billing", on: true },
    ],
  },
];

export default async function PlansPage() {
  const session = await auth();
  const email = session?.user?.email;

  let bar: React.ReactNode = null;
  if (email) {
    const live = await query<{ size_bytes: string }>(
      "SELECT size_bytes FROM sites WHERE owner_email = $1 AND deleted_at IS NULL",
      [email],
    );
    const usedBytes = live.reduce((s, r) => s + Number(r.size_bytes), 0);
    bar = (
      <AppBar
        email={email}
        name={session?.user?.name}
        active="api"
        usedBytes={usedBytes}
        siteCount={live.length}
        siteLimit={FREE_SITE_LIMIT}
        storageLimitBytes={FREE_STORAGE_BYTES}
      />
    );
  } else {
    bar = (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 30px",
          borderBottom: "1px solid var(--border)",
          background: "var(--surface-1)",
        }}
      >
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: 11 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 9,
              background: "var(--accent-soft)",
              border: "1px solid var(--accent-border)",
              display: "grid",
              placeItems: "center",
              color: "var(--accent)",
              boxShadow: "var(--glow-accent)",
            }}
          >
            <ShieldCheck size={17} />
          </div>
          <span
            style={{
              font: "800 16px/1 var(--font-ui)",
              letterSpacing: "-.02em",
              color: "var(--text)",
            }}
          >
            MicroBuild
          </span>
        </Link>
        <Link href="/login?callbackUrl=/plans" className="btn btn-neutral">
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <>
      {bar}
      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "34px 30px 100px" }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <h1
            style={{
              margin: "0 0 8px",
              font: "800 28px/1.1 var(--font-ui)",
              letterSpacing: "-.025em",
              color: "var(--text)",
            }}
          >
            Plans
          </h1>
          <p style={{ margin: 0, font: "400 14px/1.5 var(--font-ui)", color: "var(--text-muted)" }}>
            Start free. Add a team when links start piling up.
          </p>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3,1fr)",
            gap: 18,
            alignItems: "start",
          }}
        >
          {PLANS.map((p) => (
            <div
              key={p.name}
              style={{
                background: "var(--surface-1)",
                border: `1px solid ${p.highlight ? "var(--accent-border)" : "var(--border)"}`,
                borderRadius: "var(--r-lg)",
                padding: 24,
                boxShadow: p.highlight ? "var(--glow-accent)" : "var(--shadow-1)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  marginBottom: 14,
                }}
              >
                <span style={{ font: "700 15px/1 var(--font-ui)", color: "var(--text)" }}>
                  {p.name}
                </span>
                {p.tag && (
                  <span className={`pill ${p.highlight ? "pill-accent" : ""}`}>
                    <span className="mb-mono">{p.tag}</span>
                  </span>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 6 }}>
                <span
                  style={{
                    font: "800 30px/1 var(--font-ui)",
                    letterSpacing: "-.02em",
                    color: "var(--text)",
                  }}
                >
                  {p.price}
                </span>
                <span
                  className="mb-mono"
                  style={{ font: "500 12px/1 var(--font-mono)", color: "var(--text-subtle)" }}
                >
                  {p.unit}
                </span>
              </div>
              <div
                style={{
                  font: "400 12.5px/1.5 var(--font-ui)",
                  color: "var(--text-muted)",
                  marginBottom: 18,
                  minHeight: 38,
                }}
              >
                {p.blurb}
              </div>
              <Link
                href={p.cta.href}
                className={`btn ${p.highlight ? "btn-primary" : "btn-neutral"}`}
                style={{ width: "100%" }}
              >
                {p.cta.label}
              </Link>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  marginTop: 20,
                  paddingTop: 18,
                  borderTop: "1px solid var(--border)",
                }}
              >
                {p.features.map((f) => (
                  <div key={f.label} style={{ display: "flex", alignItems: "flex-start", gap: 9 }}>
                    {f.on ? (
                      <Check size={14} style={{ color: "var(--success)", flex: "none", marginTop: 1 }} />
                    ) : (
                      <Minus size={14} style={{ color: "var(--text-subtle)", flex: "none", marginTop: 1 }} />
                    )}
                    <span
                      style={{
                        font: "500 12.5px/1.4 var(--font-ui)",
                        color: f.on ? "var(--text)" : "var(--text-subtle)",
                      }}
                    >
                      {f.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            marginTop: 26,
            font: "500 11.5px/1.4 var(--font-mono)",
            color: "var(--text-subtle)",
          }}
        >
          <Lock size={13} />
          Own-domain SSO (SAML 2.0 / OIDC) and SCIM ship with Business.
        </div>
      </div>
    </>
  );
}
