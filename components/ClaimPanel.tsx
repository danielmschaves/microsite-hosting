"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, Info } from "lucide-react";
import { Banner } from "@/components/ui";

interface ClaimedSite {
  id: string;
  slug: string;
}

type Status = "loading" | "empty" | "claimed" | "error";

export function ClaimPanel() {
  const [status, setStatus] = useState<Status>("loading");
  const [sites, setSites] = useState<ClaimedSite[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        const res = await fetch("/api/guest/claim", { method: "POST" });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setStatus("error");
          return;
        }
        const claimed: ClaimedSite[] = Array.isArray(data.claimed) ? data.claimed : [];
        setSites(claimed);
        setStatus(claimed.length > 0 ? "claimed" : "empty");
      } catch {
        if (!cancelled) setStatus("error");
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  if (status === "loading") {
    return (
      <div className="card" style={{ padding: 20, font: "400 13px/1.5 var(--font-ui)", color: "var(--text-muted)" }}>
        Checking this browser for trial sites…
      </div>
    );
  }

  if (status === "error") {
    return <Banner tone="danger">Something went wrong claiming your trial sites. Try again from /try.</Banner>;
  }

  if (status === "empty") {
    return (
      <div className="card" style={{ padding: 20, display: "flex", gap: 10 }}>
        <Info size={16} style={{ color: "var(--text-subtle)", flex: "none", marginTop: 2 }} />
        <div style={{ font: "400 13px/1.5 var(--font-ui)", color: "var(--text-muted)" }}>
          No trial sites found in this browser — either you&apos;re in a different browser than the one
          you used at <code className="mb-mono">/try</code>, or there&apos;s nothing to claim. Your
          published sites live on the{" "}
          <a href="/dashboard" style={{ color: "var(--accent)" }}>
            dashboard
          </a>
          .
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
        <Banner tone="success">
          Claimed {sites.length} site{sites.length === 1 ? "" : "s"} — TTL extended to 7 days.
        </Banner>
      </div>
      {sites.map((s, i) => (
        <a
          key={s.id}
          href={`/sites/${s.id}`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "13px 18px",
            borderTop: i === 0 ? "none" : "1px solid var(--border)",
          }}
        >
          <CheckCircle2 size={15} style={{ color: "var(--accent)", flex: "none" }} />
          <span style={{ flex: 1, font: "600 13px/1.3 var(--font-ui)", color: "var(--text)" }}>{s.slug}</span>
          <ExternalLink size={13} style={{ color: "var(--text-subtle)" }} />
        </a>
      ))}
    </div>
  );
}
