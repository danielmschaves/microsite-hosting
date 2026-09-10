"use client";

import { useState } from "react";
import { ShieldCheck, Bot } from "lucide-react";
import { Pill, Banner } from "@/components/ui";
import type { AgentScope } from "@/lib/agentAuthz";

// Consent wording verbatim from PRD v2.0 §9.1 — "the tool description is the
// only marketing copy an agent ever reads" applies just as much here: this
// sentence is the only thing standing between an agent and a live publish.
const SCOPE_COPY: Record<AgentScope, string> = {
  "project:read": "See which workspaces you belong to",
  "site:read": "Read your sites and their history",
  "site:write": "Create sites and stage changes",
  "site:delete": "Move sites to trash",
  "preview:create": "Publish private previews",
  "preview:read": "Check build progress",
  "publish:request": "Ask a person to publish",
  "publish:confirm": "Publish live, visible to your audience",
  "rollback:confirm": "Revert the live site to an older version",
  "checks:run": "Run quality checks",
  "logs:read": "Read build logs",
  "template:read": "Browse templates",
  "template:create": "Create sites from templates",
  "insights:read": "See who viewed your sites",
};

const DESTRUCTIVE_SCOPES = new Set<AgentScope>(["site:delete", "publish:confirm", "rollback:confirm"]);

export function ConsentPanel({
  requestId,
  clientName,
  clientKind,
  scopes,
  expiresAt,
  workspaces,
}: {
  requestId: string;
  clientName: string;
  clientKind: string;
  scopes: string[];
  expiresAt: string;
  workspaces: { id: string; name: string }[];
}) {
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? "");
  const [busy, setBusy] = useState<"allow" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"allowed" | "denied" | null>(null);

  const normal = scopes.filter((s) => !DESTRUCTIVE_SCOPES.has(s as AgentScope));
  const destructive = scopes.filter((s) => DESTRUCTIVE_SCOPES.has(s as AgentScope));

  async function decide(decision: "allow" | "deny") {
    setBusy(decision);
    setError(null);
    try {
      const res = await fetch("/api/oauth/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, workspaceId, decision }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.message || data.error || "Something went wrong.");
        return;
      }
      if (data.redirectTo) {
        window.location.href = data.redirectTo;
        return;
      }
      setDone(decision === "allow" ? "allowed" : "denied");
    } catch {
      setError("Network error.");
    } finally {
      setBusy(null);
    }
  }

  if (done) {
    return (
      <Shell>
        <div style={{ padding: "28px 24px", textAlign: "center" }}>
          <div style={{ font: "700 16px/1.3 var(--font-ui)", color: "var(--text)", marginBottom: 8 }}>
            {done === "allowed" ? "Access granted" : "Access denied"}
          </div>
          <div style={{ font: "400 13.5px/1.5 var(--font-ui)", color: "var(--text-muted)" }}>
            {done === "allowed"
              ? "You can return to your terminal."
              : `${clientName} was not granted access.`}
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div style={{ padding: "20px 24px 4px", display: "flex", alignItems: "flex-start", gap: 12 }}>
        <Bot size={22} style={{ color: "var(--accent)", flex: "none", marginTop: 2 }} />
        <div>
          <div style={{ font: "700 16px/1.3 var(--font-ui)", color: "var(--text)" }}>
            {clientName} wants access
          </div>
          <div className="mb-mono" style={{ font: "500 11.5px/1.4 var(--font-mono)", color: "var(--text-subtle)", marginTop: 4 }}>
            {clientKind} · token expires in 90 days
          </div>
        </div>
      </div>

      {workspaces.length > 1 && (
        <div style={{ padding: "16px 24px 4px" }}>
          <div className="lbl">Workspace</div>
          <select
            className="field"
            value={workspaceId}
            onChange={(e) => setWorkspaceId(e.target.value)}
            style={{ marginTop: 6, width: "100%" }}
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div style={{ padding: "16px 24px 4px" }}>
        <div className="lbl">This grants</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
          {normal.map((s) => (
            <Pill key={s} tone="accent">
              {SCOPE_COPY[s as AgentScope] ?? s}
            </Pill>
          ))}
        </div>
      </div>

      {destructive.length > 0 && (
        <div style={{ padding: "12px 24px 4px" }}>
          <Banner tone="warning" icon={<ShieldCheck size={15} />}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {destructive.map((s) => (
                <span key={s}>
                  <strong>{SCOPE_COPY[s as AgentScope] ?? s}</strong>
                </span>
              ))}
            </div>
          </Banner>
        </div>
      )}

      <div className="mb-mono" style={{ padding: "12px 24px 0", font: "500 11px/1.4 var(--font-mono)", color: "var(--text-subtle)" }}>
        Request expires {new Date(expiresAt).toLocaleTimeString()}
      </div>

      {error && (
        <div style={{ padding: "12px 24px 0" }}>
          <Banner tone="danger">{error}</Banner>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, padding: "20px 24px 24px" }}>
        <button
          onClick={() => decide("allow")}
          disabled={busy !== null || (workspaces.length > 0 && !workspaceId)}
          className="btn btn-primary"
          style={{ flex: 1 }}
        >
          {busy === "allow" ? "Granting…" : "Allow"}
        </button>
        <button
          onClick={() => decide("deny")}
          disabled={busy !== null}
          className="btn btn-ghost"
          style={{ flex: 1 }}
        >
          {busy === "deny" ? "…" : "Deny"}
        </button>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ maxWidth: 440, margin: "60px auto", padding: "0 20px" }}>
      <div className="card" style={{ overflow: "hidden" }}>
        {children}
      </div>
    </div>
  );
}
