"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Users, Plus, ChevronRight, Crown, Shield } from "lucide-react";

export interface WorkspaceSummary {
  id: string;
  name: string;
  plan: string;
  myRole: string;
  memberCount: number;
}

export function TeamsList({ workspaces }: { workspaces: WorkspaceSummary[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (name.trim().length < 2) {
      setError("Name must be at least 2 characters.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error || "Failed to create workspace.");
      else router.push(`/teams/${data.id}`);
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 780, margin: "0 auto", padding: "34px 30px 100px" }}>
      <h1 style={{ margin: "0 0 4px", font: "800 26px/1 var(--font-ui)", letterSpacing: "-.02em", color: "var(--text)" }}>
        Teams
      </h1>
      <p style={{ margin: "0 0 28px", font: "400 13.5px/1 var(--font-ui)", color: "var(--text-muted)" }}>
        Workspaces you belong to. Team sites are visible to every member.
      </p>

      {workspaces.length > 0 && (
        <div className="card" style={{ overflow: "hidden", marginBottom: 18 }}>
          {workspaces.map((w, i) => (
            <Link
              key={w.id}
              href={`/teams/${w.id}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                padding: "16px 18px",
                borderTop: i === 0 ? "none" : "1px solid var(--border)",
                color: "var(--text)",
              }}
            >
              <div style={{ width: 40, height: 40, borderRadius: 11, background: "var(--accent-soft)", border: "1px solid var(--accent-border)", display: "grid", placeItems: "center", color: "var(--accent)", flex: "none" }}>
                <Users size={19} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ font: "700 14.5px/1.2 var(--font-ui)" }}>{w.name}</div>
                <div className="mb-mono" style={{ font: "500 11px/1 var(--font-mono)", color: "var(--text-subtle)", marginTop: 4 }}>
                  {w.memberCount} member{w.memberCount === 1 ? "" : "s"} · {w.plan === "team" ? "Team plan" : "Free"}
                </div>
              </div>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 999, background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text-muted)", font: "600 10.5px/1 var(--font-ui)", textTransform: "capitalize" }}>
                {w.myRole === "owner" ? <Crown size={11} /> : w.myRole === "admin" ? <Shield size={11} /> : null}
                {w.myRole}
              </span>
              <ChevronRight size={16} style={{ color: "var(--text-subtle)", flex: "none" }} />
            </Link>
          ))}
        </div>
      )}

      <div className="card" style={{ padding: 24 }}>
        <div style={{ font: "700 15px/1 var(--font-ui)", color: "var(--text)", marginBottom: 5 }}>
          Create a workspace
        </div>
        <div style={{ font: "400 12.5px/1.5 var(--font-ui)", color: "var(--text-muted)", marginBottom: 16 }}>
          Invite teammates and share sites with everyone at once.
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") create();
            }}
            placeholder="e.g. Acme Data Team"
            className="field"
            style={{ flex: 1 }}
          />
          <button onClick={create} disabled={busy || !name.trim()} className="btn btn-primary">
            <Plus size={15} />
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
        {error && (
          <div style={{ marginTop: 12, padding: "9px 11px", borderRadius: "var(--r-md)", background: "var(--danger-soft)", border: "1px solid var(--danger-border)", color: "var(--text)", font: "500 12px/1.4 var(--font-ui)" }}>
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
