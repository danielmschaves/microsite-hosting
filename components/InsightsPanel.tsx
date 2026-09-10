"use client";

import { useEffect, useState } from "react";
import { Eye, Users, FileText, Link2, Lock } from "lucide-react";
import { Banner, StatTile } from "@/components/ui";

interface SiteInsights {
  totalViews: number;
  uniqueViewers: number;
  viewsOverTime: { date: string; count: number }[];
  topPages: { path: string; count: number }[];
  referrers: { referrer: string; count: number }[];
  namedViewers: { email: string; views: number; lastViewedAt: string }[];
}

function agoShort(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// One chart, well made — not a wall of tiles (DS-17). No charting library:
// plain proportional bars keep this dependency-light and themeable with the
// existing token vars, and 30 days of daily counts doesn't need more.
export function InsightsPanel({ siteId }: { siteId: string }) {
  const [data, setData] = useState<SiteInsights | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [upgradeUrl, setUpgradeUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/sites/${siteId}/insights?days=30`);
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setError(body.error || "Could not load insights.");
          if (body.upgradeUrl) setUpgradeUrl(body.upgradeUrl);
          return;
        }
        setData(body);
      } catch {
        if (!cancelled) setError("Network error.");
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [siteId]);

  if (error) {
    return (
      <div className="card" style={{ padding: 20 }}>
        <Banner tone={upgradeUrl ? "warning" : "danger"}>
          {error}
          {upgradeUrl && (
            <>
              {" "}
              <a href={upgradeUrl} style={{ color: "var(--accent)", fontWeight: 700 }}>
                Upgrade
              </a>
            </>
          )}
        </Banner>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="card" style={{ padding: 20, font: "400 13px/1.5 var(--font-ui)", color: "var(--text-muted)" }}>
        Loading insights…
      </div>
    );
  }

  const maxDay = Math.max(1, ...data.viewsOverTime.map((d) => d.count));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 14 }}>
        <StatTile icon={<Eye size={12} />} label="Views (30d)" value={data.totalViews} />
        <StatTile icon={<Users size={12} />} label="Unique signed-in viewers" value={data.uniqueViewers} />
      </div>

      <div className="card" style={{ padding: 20 }}>
        <div style={{ font: "700 14px/1 var(--font-ui)", color: "var(--text)", marginBottom: 14 }}>
          Views over time
        </div>
        {data.viewsOverTime.length === 0 ? (
          <div style={{ font: "400 12.5px/1.5 var(--font-ui)", color: "var(--text-muted)" }}>
            No views in the last 30 days.
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 80 }}>
            {data.viewsOverTime.map((d) => (
              <div
                key={d.date}
                title={`${d.date}: ${d.count} view${d.count === 1 ? "" : "s"}`}
                style={{
                  flex: 1,
                  height: `${Math.max(4, (d.count / maxDay) * 80)}px`,
                  borderRadius: "3px 3px 0 0",
                  background: "var(--accent)",
                  opacity: 0.85,
                }}
              />
            ))}
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div className="card" style={{ padding: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, font: "700 14px/1 var(--font-ui)", color: "var(--text)", marginBottom: 12 }}>
            <FileText size={14} />
            Top pages
          </div>
          {data.topPages.length === 0 ? (
            <div style={{ font: "400 12.5px/1.4 var(--font-ui)", color: "var(--text-muted)" }}>No page views yet.</div>
          ) : (
            data.topPages.map((p) => (
              <div key={p.path} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", font: "500 12.5px/1.4 var(--font-mono)" }}>
                <span style={{ color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.path}</span>
                <span style={{ color: "var(--text-subtle)", flex: "none", marginLeft: 10 }}>{p.count}</span>
              </div>
            ))
          )}
        </div>

        <div className="card" style={{ padding: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, font: "700 14px/1 var(--font-ui)", color: "var(--text)", marginBottom: 12 }}>
            <Link2 size={14} />
            Referrers
          </div>
          {data.referrers.length === 0 ? (
            <div style={{ font: "400 12.5px/1.4 var(--font-ui)", color: "var(--text-muted)" }}>No referrer data yet.</div>
          ) : (
            data.referrers.map((r) => (
              <div key={r.referrer} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", font: "500 12.5px/1.4 var(--font-mono)" }}>
                <span style={{ color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.referrer}</span>
                <span style={{ color: "var(--text-subtle)", flex: "none", marginLeft: 10 }}>{r.count}</span>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="card" style={{ padding: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, font: "700 14px/1 var(--font-ui)", color: "var(--text)", marginBottom: 4 }}>
          <Users size={14} />
          Who viewed
        </div>
        <div style={{ font: "400 12px/1.4 var(--font-ui)", color: "var(--text-muted)", marginBottom: 12 }}>
          Signed-in viewers only — anonymous public views never appear here by name.
        </div>
        {data.namedViewers.length === 0 ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, font: "400 12.5px/1.4 var(--font-ui)", color: "var(--text-muted)" }}>
            <Lock size={13} />
            No signed-in views yet.
          </div>
        ) : (
          data.namedViewers.map((v) => (
            <div
              key={v.email}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "7px 0",
                borderTop: "1px solid var(--border)",
              }}
            >
              <span style={{ font: "600 12.5px/1.3 var(--font-ui)", color: "var(--text)" }}>{v.email}</span>
              <span className="mb-mono" style={{ font: "500 11px/1 var(--font-mono)", color: "var(--text-subtle)" }}>
                {v.views} view{v.views === 1 ? "" : "s"} · {agoShort(v.lastViewedAt)}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
