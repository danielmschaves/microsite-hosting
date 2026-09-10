"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, KeyRound, Activity } from "lucide-react";
import { Pill, Banner } from "@/components/ui";
import type { AgentClientView, AgentTokenView } from "@/lib/agentTokens";

function ago(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return `${Math.max(1, Math.floor(ms / 60_000))}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

interface ActivityItem {
  type: string;
  actor: string | null;
  meta: Record<string, unknown>;
  at: string;
}

// Built directly on ApiTokensPanel.tsx's structure (list/revoke,
// router.refresh() after mutation) — see CLAUDE.md's Agent Gateway section.
// Tokens are minted only via the OAuth consent screen, never from this
// panel, so there is no "create" flow here (unlike ApiTokensPanel) — just
// list + revoke + the per-token scope chips that replace the static "FULL
// ACCOUNT" pill.
export function AgentConsolePanel({
  workspaceId,
  clients,
  tokens,
}: {
  workspaceId: string;
  clients: AgentClientView[];
  tokens: AgentTokenView[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/agent-activity?workspaceId=${workspaceId}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled) setActivity(Array.isArray(data.items) ? data.items : []);
      } catch {
        /* best-effort */
      }
    }
    load();
    const t = setInterval(load, 5 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [workspaceId]);

  async function revoke(id: string) {
    if (!confirm("Revoke this token? The agent loses access on its next call.")) return;
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/agent-tokens/${id}?workspaceId=${workspaceId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Could not revoke the token.");
        return;
      }
      router.refresh();
    } catch {
      setError("Network error.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="card" style={{ overflow: "hidden", marginBottom: 18 }}>
        <div
          style={{
            padding: "17px 20px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div style={{ font: "700 15px/1 var(--font-ui)", color: "var(--text)" }}>
            Connected agents
          </div>
          <div
            style={{
              font: "400 12px/1.4 var(--font-ui)",
              color: "var(--text-muted)",
              marginTop: 5,
            }}
          >
            Tokens are minted when a human approves an agent&apos;s access request — see{" "}
            <code className="mb-mono">/oauth/device</code> for the install flow.
          </div>
        </div>

        {error && (
          <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--border)" }}>
            <Banner tone="danger">{error}</Banner>
          </div>
        )}

        {tokens.length === 0 && (
          <div
            style={{
              padding: "18px 20px",
              font: "400 12.5px/1.5 var(--font-ui)",
              color: "var(--text-muted)",
            }}
          >
            No agents connected yet.
          </div>
        )}

        {tokens.map((t) => (
          <div
            key={t.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              padding: "14px 20px",
              borderTop: "1px solid var(--border)",
            }}
          >
            <Bot size={16} style={{ color: "var(--text-subtle)", flex: "none" }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ font: "600 13px/1.2 var(--font-ui)", color: "var(--text)" }}>
                {t.clientName}{" "}
                <span style={{ color: "var(--text-subtle)", fontWeight: 400 }}>· {t.clientKind}</span>
              </div>
              <div
                className="mb-mono"
                style={{
                  font: "500 11px/1 var(--font-mono)",
                  color: "var(--text-subtle)",
                  marginTop: 5,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <KeyRound size={11} />
                {t.prefix}
                {"••••••••"} · last used {ago(t.lastUsedAt)}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                {t.scopes.map((s) => (
                  <Pill key={s} tone="accent" mono>
                    {s}
                  </Pill>
                ))}
              </div>
            </div>
            <button
              onClick={() => revoke(t.id)}
              disabled={busy !== null}
              className="btn btn-ghost"
              style={{
                padding: "7px 11px",
                font: "600 11.5px/1 var(--font-ui)",
                border: "1px solid var(--border-strong)",
                flex: "none",
              }}
            >
              {busy === t.id ? "Revoking…" : "Revoke"}
            </button>
          </div>
        ))}
      </div>

      {clients.length > 0 && (
        <div className="card" style={{ overflow: "hidden", marginBottom: 18, padding: "17px 20px" }}>
          <div style={{ font: "700 15px/1 var(--font-ui)", color: "var(--text)", marginBottom: 12 }}>
            Clients seen
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {clients.map((c) => (
              <div key={c.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
                <span style={{ color: "var(--text)" }}>
                  {c.name} <span style={{ color: "var(--text-subtle)" }}>({c.kind})</span>
                </span>
                <span className="mb-mono" style={{ color: "var(--text-subtle)" }}>
                  last seen {ago(c.lastSeenAt)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card" style={{ overflow: "hidden", padding: "17px 20px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            font: "700 15px/1 var(--font-ui)",
            color: "var(--text)",
            marginBottom: 12,
          }}
        >
          <Activity size={15} />
          Agent activity (24h)
        </div>
        {activity.length === 0 ? (
          <div style={{ font: "400 12.5px/1.5 var(--font-ui)", color: "var(--text-muted)" }}>
            No agent activity in the last 24 hours.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {activity.map((a, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
                <span className="mb-mono" style={{ color: "var(--text)" }}>
                  {a.type}
                  {typeof a.meta?.tool === "string" ? ` · ${a.meta.tool}` : ""}
                </span>
                <span className="mb-mono" style={{ color: "var(--text-subtle)" }}>
                  {ago(a.at)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
