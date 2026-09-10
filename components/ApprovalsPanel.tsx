"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, XCircle, Clock, Rocket, RotateCcw } from "lucide-react";
import { Pill, Banner } from "@/components/ui";

export interface ApprovalItem {
  id: string;
  slug: string;
  action: "publish" | "rollback";
  requestedBy: string;
  message: string | null;
  targetVersion: number | null;
  expiresAt: string;
}

function timeLeft(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "expired";
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return `${Math.max(1, Math.floor(ms / 60_000))}m`;
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

// Structural clone of AgentConsolePanel.tsx's list+button shape (see
// CLAUDE.md's Agent Gateway section) — plain native <button>/<input>
// elements only, no click-handler <div>s, so the whole flow works
// Tab/Enter/Space-only per CD-17's keyboard-only requirement.
export function ApprovalsPanel({ workspaceId, items }: { workspaceId: string; items: ApprovalItem[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  async function decide(id: string, decision: "approve" | "reject") {
    setBusy(`${id}-${decision}`);
    setError(null);
    try {
      const res = await fetch(`/api/approvals/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, note: notes[id] || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error === "already_decided" ? "Already decided." : data.message || data.error || "Request failed.");
        router.refresh();
        return;
      }
      router.refresh();
    } catch {
      setError("Network error.");
    } finally {
      setBusy(null);
    }
  }

  if (items.length === 0) {
    return (
      <div className="card" style={{ padding: 20 }}>
        <div style={{ font: "400 13.5px/1.5 var(--font-ui)", color: "var(--text-muted)" }}>
          No pending approvals. Agent publish/rollback requests in this workspace show up here
          when <code className="mb-mono">publish_mode</code> is set to <code className="mb-mono">approval</code>.
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={{ overflow: "hidden" }}>
      {error && (
        <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--border)" }}>
          <Banner tone="danger">{error}</Banner>
        </div>
      )}
      {items.map((a, i) => (
        <div
          key={a.id}
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 14,
            padding: "16px 20px",
            borderTop: i === 0 ? "none" : "1px solid var(--border)",
          }}
        >
          {a.action === "publish" ? (
            <Rocket size={16} style={{ color: "var(--accent)", flex: "none", marginTop: 2 }} />
          ) : (
            <RotateCcw size={16} style={{ color: "var(--warning)", flex: "none", marginTop: 2 }} />
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ font: "600 13px/1.3 var(--font-ui)", color: "var(--text)" }}>
              {a.action === "publish" ? "Publish" : `Roll back to v${a.targetVersion}`} &ldquo;{a.slug}&rdquo;
            </div>
            <div
              className="mb-mono"
              style={{ font: "500 11px/1 var(--font-mono)", color: "var(--text-subtle)", marginTop: 5 }}
            >
              requested by {a.requestedBy} · <Clock size={10} style={{ verticalAlign: -1 }} /> expires in {timeLeft(a.expiresAt)}
            </div>
            {a.message && (
              <div style={{ font: "400 12.5px/1.4 var(--font-ui)", color: "var(--text-muted)", marginTop: 6 }}>
                &ldquo;{a.message}&rdquo;
              </div>
            )}
            <input
              value={notes[a.id] ?? ""}
              onChange={(e) => setNotes((n) => ({ ...n, [a.id]: e.target.value }))}
              placeholder="Optional note…"
              className="field"
              style={{ marginTop: 10, width: "100%", maxWidth: 320, padding: "6px 9px", font: "400 12px/1 var(--font-ui)" }}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7, flex: "none" }}>
            <button
              onClick={() => decide(a.id, "approve")}
              disabled={busy !== null}
              className="btn btn-primary"
              style={{ padding: "7px 12px", font: "600 12px/1 var(--font-ui)", whiteSpace: "nowrap" }}
            >
              <CheckCircle2 size={13} />
              {busy === `${a.id}-approve` ? "Approving…" : "Approve"}
            </button>
            <button
              onClick={() => decide(a.id, "reject")}
              disabled={busy !== null}
              className="btn btn-ghost"
              style={{
                padding: "7px 12px",
                font: "600 12px/1 var(--font-ui)",
                border: "1px solid var(--border-strong)",
                whiteSpace: "nowrap",
              }}
            >
              <XCircle size={13} />
              {busy === `${a.id}-reject` ? "Rejecting…" : "Reject"}
            </button>
          </div>
        </div>
      ))}
      <div style={{ padding: "10px 20px", background: "var(--surface-2)" }}>
        <Pill mono>{items.length} pending</Pill>
      </div>
    </div>
  );
}
