"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Check, KeyRound, Plus, X } from "lucide-react";
import { Banner } from "@/components/ui";
import type { TokenView } from "@/lib/apiTokens";

function ago(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return `${Math.max(1, Math.floor(ms / 60_000))}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function ApiTokensPanel({ tokens }: { tokens: TokenView[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [freshSecret, setFreshSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function create() {
    setBusy("create");
    setError(null);
    try {
      const res = await fetch("/api/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nameDraft.trim() || "API token" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not create the token.");
        return;
      }
      // The secret exists only in this response — render it from state, never refetch.
      setFreshSecret(data.secret);
      setCreating(false);
      setNameDraft("");
      router.refresh();
    } catch {
      setError("Network error.");
    } finally {
      setBusy(null);
    }
  }

  async function revoke(id: string) {
    if (!confirm("Revoke this token? Any script using it stops deploying immediately."))
      return;
    setBusy(`revoke-${id}`);
    setError(null);
    try {
      const res = await fetch(`/api/tokens/${id}`, { method: "DELETE" });
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

  async function copySecret() {
    if (!freshSecret) return;
    try {
      await navigator.clipboard.writeText(freshSecret);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="card" style={{ overflow: "hidden", marginBottom: 18 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "17px 20px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div>
          <div style={{ font: "700 15px/1 var(--font-ui)", color: "var(--text)" }}>
            Access tokens
          </div>
          <div
            style={{
              font: "400 12px/1.4 var(--font-ui)",
              color: "var(--text-muted)",
              marginTop: 5,
            }}
          >
            Scoped to your account. Shown once at creation.
          </div>
        </div>
        <button
          onClick={() => {
            setCreating((c) => !c);
            setFreshSecret(null);
          }}
          className="btn btn-primary"
          style={{ padding: "9px 14px", font: "600 12.5px/1 var(--font-ui)" }}
        >
          <Plus size={14} />
          New token
        </button>
      </div>

      {error && (
        <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--border)" }}>
          <Banner tone="danger">{error}</Banner>
        </div>
      )}

      {creating && (
        <div
          style={{
            display: "flex",
            gap: 10,
            padding: "14px 20px",
            borderBottom: "1px solid var(--border)",
            background: "var(--surface-2)",
          }}
        >
          <input
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") create();
            }}
            placeholder="What will use this token? e.g. ci-deploy"
            className="field"
            style={{ flex: 1 }}
            autoFocus
          />
          <button onClick={create} disabled={busy !== null} className="btn btn-primary">
            {busy === "create" ? "Creating…" : "Create token"}
          </button>
          <button
            onClick={() => setCreating(false)}
            className="icon-btn"
            aria-label="Cancel"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {freshSecret && (
        <div
          style={{
            padding: "14px 20px",
            borderBottom: "1px solid var(--border)",
            background: "var(--success-soft)",
          }}
        >
          <div
            style={{
              font: "600 12.5px/1.4 var(--font-ui)",
              color: "var(--text)",
              marginBottom: 8,
            }}
          >
            Copy it now — it will not be shown again.
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <code
              className="mb-mono"
              style={{
                flex: 1,
                minWidth: 0,
                padding: "9px 12px",
                borderRadius: "var(--r-md)",
                background: "var(--surface-1)",
                border: "1px solid var(--border-strong)",
                font: "500 12.5px/1 var(--font-mono)",
                color: "var(--text)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {freshSecret}
            </code>
            <button onClick={copySecret} className="btn btn-neutral" style={{ flex: "none" }}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}

      {tokens.length === 0 && !creating && (
        <div
          style={{
            padding: "18px 20px",
            font: "400 12.5px/1.5 var(--font-ui)",
            color: "var(--text-muted)",
          }}
        >
          No tokens yet. Create one to publish from a script or CI job.
        </div>
      )}

      {tokens.map((k) => (
        <div
          key={k.id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "14px 20px",
            borderTop: "1px solid var(--border)",
          }}
        >
          <KeyRound size={16} style={{ color: "var(--text-subtle)", flex: "none" }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ font: "600 13px/1.2 var(--font-ui)", color: "var(--text)" }}>
              {k.name}
            </div>
            <div
              className="mb-mono"
              style={{
                font: "500 11px/1 var(--font-mono)",
                color: "var(--text-subtle)",
                marginTop: 5,
              }}
            >
              {k.prefix}
              {"••••••••"} · last used {ago(k.lastUsedAt)}
            </div>
          </div>
          <span className="pill">
            <span className="mb-mono">FULL ACCOUNT</span>
          </span>
          <button
            onClick={() => revoke(k.id)}
            disabled={busy !== null}
            className="btn btn-ghost"
            style={{
              padding: "7px 11px",
              font: "600 11.5px/1 var(--font-ui)",
              border: "1px solid var(--border-strong)",
              flex: "none",
            }}
          >
            {busy === `revoke-${k.id}` ? "Revoking…" : "Revoke"}
          </button>
        </div>
      ))}
    </div>
  );
}
