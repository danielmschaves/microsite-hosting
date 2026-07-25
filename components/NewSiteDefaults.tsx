"use client";

import { useEffect, useState } from "react";
import { Clock, Info, User, Users, Mail, X } from "lucide-react";

// "Defaults for new sites" (from the MicroBuild App design): pre-fills the
// upload form so publishing stays a one-click action. Stored client-side in
// localStorage — these are personal preferences, not server state.

export const DEFAULTS_KEYS = {
  ttl: "mb-default-ttl",
  visibility: "mb-default-visibility",
  viewers: "mb-default-viewers",
} as const;

const TTL_LABEL: Record<string, string> = {
  "24h": "24 hours",
  "7d": "7 days",
  "30d": "30 days",
};
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function NewSiteDefaults({ personalTtls }: { personalTtls: string[] }) {
  const [ttl, setTtl] = useState("7d");
  const [visibility, setVisibility] = useState<"only_me" | "allowlist">("allowlist");
  const [chips, setChips] = useState<string[]>([]);
  const [chipInput, setChipInput] = useState("");

  useEffect(() => {
    try {
      const t = localStorage.getItem(DEFAULTS_KEYS.ttl);
      if (t && t in TTL_LABEL) setTtl(t);
      const v = localStorage.getItem(DEFAULTS_KEYS.visibility);
      if (v === "only_me" || v === "allowlist") setVisibility(v);
      const c = JSON.parse(localStorage.getItem(DEFAULTS_KEYS.viewers) || "[]");
      if (Array.isArray(c)) setChips(c.filter((x) => typeof x === "string"));
    } catch {
      /* ignore */
    }
  }, []);

  function save(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* ignore */
    }
  }

  function commitChip() {
    const v = chipInput.trim().toLowerCase();
    if (!v || !EMAIL_RE.test(v)) return;
    if (!chips.includes(v)) {
      const next = [...chips, v];
      setChips(next);
      save(DEFAULTS_KEYS.viewers, JSON.stringify(next));
    }
    setChipInput("");
  }

  function removeChip(i: number) {
    const next = chips.filter((_, j) => j !== i);
    setChips(next);
    save(DEFAULTS_KEYS.viewers, JSON.stringify(next));
  }

  return (
    <div className="card" style={{ padding: 24, marginBottom: 18 }}>
      <div style={{ font: "700 15px/1 var(--font-ui)", color: "var(--text)", marginBottom: 5 }}>
        Defaults for new sites
      </div>
      <div style={{ font: "400 12.5px/1.5 var(--font-ui)", color: "var(--text-muted)", marginBottom: 20 }}>
        Pre-fill every upload so publishing stays a one-click action.
      </div>

      <label className="lbl">Default lifespan</label>
      <div className="seg-group" style={{ marginBottom: 8 }}>
        {(["24h", "7d", "30d"] as const).map((k) => {
          const locked = !personalTtls.includes(k);
          return (
            <button
              key={k}
              className={`seg${ttl === k ? " active" : ""}`}
              disabled={locked}
              style={locked ? { opacity: 0.45, cursor: "not-allowed" } : undefined}
              onClick={() => {
                setTtl(k);
                save(DEFAULTS_KEYS.ttl, k);
              }}
            >
              <Clock size={14} />
              {TTL_LABEL[k]}
            </button>
          );
        })}
      </div>
      <div className="hint" style={{ marginBottom: 20 }}>
        <Info size={12} />
        Free plan max TTL is 7 days. Upgrade a workspace for 90.
      </div>

      <label className="lbl">Default visibility</label>
      <div className="seg-group" style={{ marginBottom: 20 }}>
        <button
          className={`seg${visibility === "only_me" ? " active" : ""}`}
          onClick={() => {
            setVisibility("only_me");
            save(DEFAULTS_KEYS.visibility, "only_me");
          }}
        >
          <User size={14} />
          Only me
        </button>
        <button
          className={`seg${visibility === "allowlist" ? " active" : ""}`}
          onClick={() => {
            setVisibility("allowlist");
            save(DEFAULTS_KEYS.visibility, "allowlist");
          }}
        >
          <Users size={14} />
          Email allowlist
        </button>
      </div>

      <label className="lbl">Default allowlist</label>
      <div className="focus-ring" style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", padding: 10, borderRadius: "var(--r-md)", background: "var(--surface-2)", border: "1px solid var(--border-strong)" }}>
        {chips.map((chip, i) => (
          <span key={chip} style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "5px 8px 5px 11px", borderRadius: 999, background: "var(--accent-soft)", border: "1px solid var(--accent-border)", color: "var(--text)", font: "500 12.5px/1 var(--font-ui)", whiteSpace: "nowrap" }}>
            <Mail size={12} style={{ color: "var(--accent)" }} />
            {chip}
            <button
              onClick={() => removeChip(i)}
              aria-label="remove"
              style={{ display: "grid", placeItems: "center", width: 16, height: 16, borderRadius: 999, border: "none", background: "transparent", color: "var(--text-muted)", cursor: "pointer" }}
            >
              <X size={11} />
            </button>
          </span>
        ))}
        <input
          value={chipInput}
          onChange={(e) => setChipInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              commitChip();
            }
          }}
          onBlur={commitChip}
          placeholder="name@company.com"
          style={{ flex: 1, minWidth: 150, padding: "6px 4px", border: "none", background: "transparent", color: "var(--text)", font: "500 13.5px/1 var(--font-ui)", outline: "none" }}
        />
      </div>
    </div>
  );
}
