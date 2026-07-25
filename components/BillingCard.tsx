"use client";

import { useState } from "react";
import { CreditCard, Sparkles, ExternalLink } from "lucide-react";

export interface BillingInfo {
  workspaceId: string;
  plan: string;
  status: string | null;
  seats: number;
  memberCount: number;
  isOwner: boolean;
  billingEnabled: boolean;
  fakeTeam: boolean;
  minSeats: number;
}

export function BillingCard({ info }: { info: BillingInfo }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go(path: "checkout" | "portal") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/workspaces/${info.workspaceId}/billing/${path}`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error || "Billing request failed.");
      else window.location.href = data.url;
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  const isTeam = info.plan === "team";
  const billableSeats = Math.max(info.minSeats, info.memberCount);

  return (
    <div className="card" style={{ padding: 24, marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, font: "700 15px/1 var(--font-ui)", color: "var(--text)", marginBottom: 5 }}>
        <CreditCard size={15} />
        Billing
      </div>

      {info.fakeTeam ? (
        <div style={{ font: "400 12.5px/1.5 var(--font-ui)", color: "var(--text-muted)" }}>
          <span className="mb-mono" style={{ color: "var(--warning)" }}>PLAN_FAKE_TEAM</span> is
          on — this workspace behaves as Team plan without Stripe (local dev only).
        </div>
      ) : !info.billingEnabled ? (
        <div style={{ font: "400 12.5px/1.5 var(--font-ui)", color: "var(--text-subtle)" }}>
          Billing is not configured on this deployment.
        </div>
      ) : isTeam ? (
        <>
          <div style={{ font: "400 12.5px/1.5 var(--font-ui)", color: "var(--text-muted)", marginBottom: 16 }}>
            Team plan · {info.seats} seat{info.seats === 1 ? "" : "s"} · status{" "}
            <span className="mb-mono" style={{ color: info.status === "active" || info.status === "trialing" ? "var(--success)" : "var(--warning)" }}>
              {info.status}
            </span>
            . Seats follow your member count automatically (min {info.minSeats}).
          </div>
          {info.isOwner && (
            <button onClick={() => go("portal")} disabled={busy} className="btn btn-neutral">
              <ExternalLink size={14} />
              {busy ? "Opening…" : "Manage billing"}
            </button>
          )}
        </>
      ) : (
        <>
          <div style={{ font: "400 12.5px/1.5 var(--font-ui)", color: "var(--text-muted)", marginBottom: 16 }}>
            Upgrade to publish <strong style={{ color: "var(--text)" }}>team-visible sites</strong> and
            unlock 100 sites, 250 MB uploads, 90-day TTLs and the audit log.
            ~$5/user/mo · {billableSeats} seat{billableSeats === 1 ? "" : "s"} for your current team.
          </div>
          {info.isOwner ? (
            <button onClick={() => go("checkout")} disabled={busy} className="btn btn-primary">
              <Sparkles size={14} />
              {busy ? "Opening…" : "Upgrade to Team"}
            </button>
          ) : (
            <div style={{ font: "500 12px/1.4 var(--font-ui)", color: "var(--text-subtle)" }}>
              Ask the workspace owner to upgrade.
            </div>
          )}
        </>
      )}

      {error && (
        <div style={{ marginTop: 12, padding: "9px 11px", borderRadius: "var(--r-md)", background: "var(--danger-soft)", border: "1px solid var(--danger-border)", color: "var(--text)", font: "500 12px/1.4 var(--font-ui)" }}>
          {error}
        </div>
      )}
    </div>
  );
}
