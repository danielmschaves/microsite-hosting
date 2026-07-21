"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Plus,
  Search,
  LayoutGrid,
  List,
  Copy,
  TimerReset,
  Trash2,
  Clock,
  Timer,
  Ban,
  Lock,
  Link2,
  Users,
  UploadCloud,
  Check,
  Eye,
  FileCode2,
  Settings2,
  ArchiveRestore,
} from "lucide-react";

export interface SiteView {
  id: string;
  slug: string;
  url: string;
  sizeBytes: number;
  pageCount: number;
  ttlPreset: string;
  expiresAt: string;
  viewersLabel: string;
  views: number;
  lastViewedAt: string | null;
}

export interface TrashView {
  id: string;
  slug: string;
  sizeBytes: number;
  purgeAt: string;
}

type State = "fresh" | "expiring" | "expired";

const TTL_LABEL: Record<string, string> = {
  "24h": "24 hours",
  "7d": "7 days",
  "30d": "30 days",
};

function sizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function computeState(expiresMs: number, nowMs: number): State {
  const rem = expiresMs - nowMs;
  if (rem <= 0) return "expired";
  if (rem < 24 * 3600 * 1000) return "expiring";
  return "fresh";
}

function countdownLabel(expiresMs: number, nowMs: number): string {
  let s = Math.floor((expiresMs - nowMs) / 1000);
  if (s <= 0) return "Expired";
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  if (d >= 1) return `${d}d ${String(h).padStart(2, "0")}h`;
  return `${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m`;
}

const CD_CONF: Record<State, { color: string; Icon: typeof Clock }> = {
  fresh: { color: "var(--success)", Icon: Clock },
  expiring: { color: "var(--warning)", Icon: Timer },
  expired: { color: "var(--danger)", Icon: Ban },
};

export function SitesView({
  sites,
  trash,
}: {
  sites: SiteView[];
  trash: TrashView[];
}) {
  const router = useRouter();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [view, setView] = useState<"grid" | "list">("grid");
  const [q, setQ] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [extendId, setExtendId] = useState<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem("mb-view");
    if (saved === "grid" || saved === "list") setView(saved);
  }, []);

  function setViewPersist(v: "grid" | "list") {
    setView(v);
    try {
      localStorage.setItem("mb-view", v);
    } catch {
      /* ignore */
    }
  }

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return sites;
    return sites.filter((s) => s.slug.toLowerCase().includes(needle));
  }, [sites, q]);

  async function copy(site: SiteView) {
    try {
      await navigator.clipboard.writeText(site.url);
      setToast("Link copied to clipboard");
      setTimeout(() => setToast(null), 2000);
    } catch {
      setToast("Copy failed — select the URL manually");
      setTimeout(() => setToast(null), 2500);
    }
  }

  const deleteSite = sites.find((s) => s.id === deleteId) || null;
  const extendSite = sites.find((s) => s.id === extendId) || null;

  return (
    <div className="container">
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 20,
          flexWrap: "wrap",
          marginBottom: 22,
        }}
      >
        <div>
          <h1 style={{ margin: "0 0 6px", font: "800 26px/1 var(--font-ui)", letterSpacing: "-.02em", color: "var(--text)" }}>
            Your sites
          </h1>
          <p style={{ margin: 0, font: "400 13.5px/1 var(--font-ui)", color: "var(--text-muted)" }}>
            {sites.length} active · {sites.reduce((s, x) => s + x.views, 0)} total views · private by default
          </p>
        </div>
        <Link href="/upload" className="btn btn-primary">
          <Plus size={16} />
          New site
        </Link>
      </div>

      {sites.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 14,
              flexWrap: "wrap",
              marginBottom: 22,
            }}
          >
            <div style={{ position: "relative", flex: 1, maxWidth: 340 }}>
              <Search size={15} style={{ position: "absolute", left: 12, top: 11, color: "var(--text-subtle)" }} />
              <input
                className="field"
                placeholder="Search sites…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                style={{ paddingLeft: 34 }}
              />
            </div>
            <div style={{ display: "flex", gap: 3, padding: 3, borderRadius: 9, background: "var(--surface-2)", border: "1px solid var(--border)" }}>
              <ViewBtn active={view === "grid"} onClick={() => setViewPersist("grid")} label="grid">
                <LayoutGrid size={15} />
              </ViewBtn>
              <ViewBtn active={view === "list"} onClick={() => setViewPersist("list")} label="list">
                <List size={15} />
              </ViewBtn>
            </div>
          </div>

          {filtered.length === 0 ? (
            <p style={{ font: "400 13.5px/1 var(--font-ui)", color: "var(--text-muted)" }}>
              No sites match “{q}”.
            </p>
          ) : view === "grid" ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(320px,1fr))", gap: 18 }}>
              {filtered.map((s) => (
                <SiteCard
                  key={s.id}
                  site={s}
                  nowMs={nowMs}
                  onCopy={() => copy(s)}
                  onExtend={() => setExtendId(s.id)}
                  onDelete={() => setDeleteId(s.id)}
                />
              ))}
            </div>
          ) : (
            <div className="card" style={{ overflow: "hidden" }}>
              {filtered.map((s, i) => (
                <SiteRow
                  key={s.id}
                  site={s}
                  nowMs={nowMs}
                  first={i === 0}
                  onCopy={() => copy(s)}
                  onExtend={() => setExtendId(s.id)}
                  onDelete={() => setDeleteId(s.id)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {trash.length > 0 && (
        <TrashSection trash={trash} nowMs={nowMs} onChanged={() => router.refresh()} />
      )}

      {toast && <Toast message={toast} />}

      {deleteSite && (
        <DeleteModal
          site={deleteSite}
          onClose={() => setDeleteId(null)}
          onDone={() => {
            setDeleteId(null);
            router.refresh();
          }}
        />
      )}
      {extendSite && (
        <ExtendModal
          site={extendSite}
          onClose={() => setExtendId(null)}
          onDone={() => {
            setExtendId(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function ViewBtn({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      style={{
        display: "grid",
        placeItems: "center",
        width: 30,
        height: 26,
        borderRadius: 7,
        cursor: "pointer",
        border: "1px solid transparent",
        background: active ? "var(--surface-hover)" : "transparent",
        color: active ? "var(--text)" : "var(--text-subtle)",
      }}
    >
      {children}
    </button>
  );
}

function Countdown({ site, nowMs, corner }: { site: SiteView; nowMs: number; corner: boolean }) {
  const expiresMs = new Date(site.expiresAt).getTime();
  const st = computeState(expiresMs, nowMs);
  const { color, Icon } = CD_CONF[st];
  const style: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "5px 10px",
    borderRadius: 999,
    background: `color-mix(in srgb, ${color} 15%, var(--bg))`,
    border: `1px solid color-mix(in srgb, ${color} 40%, transparent)`,
    color: "var(--text)",
    font: "600 11px/1 var(--font-ui)",
    whiteSpace: "nowrap",
    flex: "none",
    ...(st === "expiring" ? { animation: "mb-pulse 2s ease-in-out infinite" } : {}),
    ...(corner
      ? { position: "absolute", top: 12, right: 12, backdropFilter: "blur(6px)" }
      : {}),
  };
  return (
    <span style={style}>
      <Icon size={12} style={{ color }} />
      <span className="mb-mono" style={{ color }}>
        {countdownLabel(expiresMs, nowMs)}
      </span>
    </span>
  );
}

function Badges({ site }: { site: SiteView }) {
  const pill = (bg: string, bd: string, col: string): React.CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 9px",
    borderRadius: 999,
    background: bg,
    border: `1px solid ${bd}`,
    color: col,
    font: "600 10.5px/1 var(--font-ui)",
    whiteSpace: "nowrap",
    flex: "none",
  });
  return (
    <>
      <span style={pill("var(--accent-soft)", "var(--accent-border)", "var(--text)")}>
        <Lock size={11} style={{ color: "var(--accent)" }} />
        Private
      </span>
      <span style={pill("var(--surface-3)", "var(--border-strong)", "var(--text-muted)")}>
        <Users size={11} />
        {site.viewersLabel}
      </span>
      <span style={pill("var(--surface-3)", "var(--border-strong)", "var(--text-muted)")}>
        <Timer size={11} />
        {TTL_LABEL[site.ttlPreset] || site.ttlPreset}
      </span>
      {site.pageCount > 1 && (
        <span style={pill("var(--surface-3)", "var(--border-strong)", "var(--text-muted)")}>
          <FileCode2 size={11} />
          {site.pageCount} pages
        </span>
      )}
      <span style={pill("var(--surface-3)", "var(--border-strong)", "var(--text-muted)")}>
        <Eye size={11} />
        {site.views} view{site.views === 1 ? "" : "s"}
      </span>
    </>
  );
}

function thumbStyle(expired: boolean): React.CSSProperties {
  return {
    position: "relative",
    height: 128,
    display: "grid",
    placeItems: "center",
    backgroundImage:
      "repeating-linear-gradient(135deg, var(--surface-3) 0 11px, var(--surface-2) 11px 22px)",
    borderBottom: "1px solid var(--border)",
    opacity: expired ? 0.5 : 1,
    filter: expired ? "grayscale(.6)" : "none",
  };
}

function SiteCard({
  site,
  nowMs,
  onCopy,
  onExtend,
  onDelete,
}: {
  site: SiteView;
  nowMs: number;
  onCopy: () => void;
  onExtend: () => void;
  onDelete: () => void;
}) {
  const expired = new Date(site.expiresAt).getTime() <= nowMs;
  return (
    <div className="card" style={{ overflow: "hidden", boxShadow: "var(--shadow-1)" }}>
      <div style={thumbStyle(expired)}>
        <span style={{ font: "600 11px/1 var(--font-mono)", letterSpacing: ".1em", color: "var(--text-subtle)" }}>
          HTML
        </span>
        <span
          style={{
            position: "absolute",
            top: 12,
            left: 12,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "5px 10px",
            borderRadius: 999,
            background: "color-mix(in srgb, var(--bg) 70%, transparent)",
            backdropFilter: "blur(6px)",
            border: "1px solid var(--border)",
            color: "var(--text)",
            font: "600 10.5px/1 var(--font-ui)",
            whiteSpace: "nowrap",
          }}
        >
          <Lock size={11} style={{ color: "var(--accent)" }} />
          Private
        </span>
        <Countdown site={site} nowMs={nowMs} corner />
      </div>
      <div style={{ padding: "15px 16px 14px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 9 }}>
          <div
            style={{
              font: "700 14.5px/1.1 var(--font-ui)",
              color: "var(--text)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {site.slug}
          </div>
          <span style={{ font: "500 11px/1 var(--font-mono)", color: "var(--text-subtle)", flex: "none" }}>
            {sizeLabel(site.sizeBytes)}
          </span>
        </div>
        <a
          href={site.url}
          target="_blank"
          rel="noreferrer"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            padding: "7px 9px",
            borderRadius: 8,
            background: "var(--surface-2)",
            border: "1px solid var(--border)",
            marginBottom: 12,
            color: "var(--text-muted)",
          }}
        >
          <Link2 size={12} style={{ color: "var(--text-subtle)", flex: "none" }} />
          <span
            className="mb-mono"
            style={{ font: "500 11.5px/1 var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            /s/{site.slug}
          </span>
        </a>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
          <Badges site={site} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <button
            onClick={onCopy}
            className="btn btn-neutral"
            style={{ flex: 1, padding: "8px 10px", borderRadius: 9, font: "600 12.5px/1 var(--font-ui)" }}
          >
            <Copy size={13} />
            Copy link
          </button>
          <Link href={`/sites/${site.id}`} className="icon-btn" aria-label="Manage site">
            <Settings2 size={15} />
          </Link>
          <button onClick={onExtend} className="icon-btn" aria-label="Extend TTL">
            <TimerReset size={15} />
          </button>
          <button onClick={onDelete} className="icon-btn danger" aria-label="Move to trash">
            <Trash2 size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}

function SiteRow({
  site,
  nowMs,
  first,
  onCopy,
  onExtend,
  onDelete,
}: {
  site: SiteView;
  nowMs: number;
  first: boolean;
  onCopy: () => void;
  onExtend: () => void;
  onDelete: () => void;
}) {
  const expired = new Date(site.expiresAt).getTime() <= nowMs;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "12px 16px",
        borderTop: first ? "none" : "1px solid var(--border)",
      }}
    >
      <div
        style={{
          width: 52,
          height: 38,
          borderRadius: 8,
          flex: "none",
          backgroundImage:
            "repeating-linear-gradient(135deg, var(--surface-3) 0 6px, var(--surface-2) 6px 12px)",
          border: "1px solid var(--border)",
          opacity: expired ? 0.5 : 1,
        }}
      />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ font: "700 13.5px/1.1 var(--font-ui)", color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {site.slug}
        </div>
        <a
          href={site.url}
          target="_blank"
          rel="noreferrer"
          className="mb-mono"
          style={{ display: "block", font: "500 11px/1 var(--font-mono)", color: "var(--text-subtle)", marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          /s/{site.slug}
        </a>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", justifyContent: "flex-end", maxWidth: 260 }}>
        <Badges site={site} />
      </div>
      <Countdown site={site} nowMs={nowMs} corner={false} />
      <span style={{ font: "500 11.5px/1 var(--font-mono)", color: "var(--text-subtle)", flex: "none", width: 64, textAlign: "right" }}>
        {sizeLabel(site.sizeBytes)}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flex: "none" }}>
        <button onClick={onCopy} className="icon-btn" aria-label="Copy link" style={{ width: 32, height: 32, background: "transparent" }}>
          <Copy size={14} />
        </button>
        <Link href={`/sites/${site.id}`} className="icon-btn" aria-label="Manage" style={{ width: 32, height: 32, background: "transparent" }}>
          <Settings2 size={14} />
        </Link>
        <button onClick={onExtend} className="icon-btn" aria-label="Extend" style={{ width: 32, height: 32, background: "transparent" }}>
          <TimerReset size={14} />
        </button>
        <button onClick={onDelete} className="icon-btn danger" aria-label="Move to trash" style={{ width: 32, height: 32, background: "transparent" }}>
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        padding: "64px 24px",
        border: "1.5px dashed var(--border-strong)",
        borderRadius: "var(--r-lg)",
        background: "var(--surface-1)",
      }}
    >
      <div
        style={{
          width: 72,
          height: 72,
          borderRadius: 19,
          background: "var(--accent-soft)",
          border: "1px solid var(--accent-border)",
          display: "grid",
          placeItems: "center",
          color: "var(--accent)",
          boxShadow: "var(--glow-accent)",
          marginBottom: 22,
        }}
      >
        <UploadCloud size={34} />
      </div>
      <h2 style={{ margin: "0 0 10px", font: "800 21px/1.2 var(--font-ui)", letterSpacing: "-.02em", color: "var(--text)" }}>
        No sites yet
      </h2>
      <p style={{ margin: "0 0 24px", font: "400 14px/1.6 var(--font-ui)", color: "var(--text-muted)", maxWidth: "44ch" }}>
        Drop a self-contained HTML file to get a private, SSO-gated link that expires
        on your schedule. Upload to link in under 30 seconds.
      </p>
      <Link href="/upload" className="btn btn-primary" style={{ padding: "12px 20px", font: "600 14px/1 var(--font-ui)" }}>
        <UploadCloud size={16} />
        Upload your first site
      </Link>
    </div>
  );
}

function TrashSection({
  trash,
  nowMs,
  onChanged,
}: {
  trash: TrashView[];
  nowMs: number;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function restore(t: TrashView) {
    setBusy(t.id);
    setErr(null);
    try {
      const res = await fetch(`/api/sites/${t.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setErr(data.error || "Restore failed.");
      else onChanged();
    } finally {
      setBusy(null);
    }
  }

  async function purge(t: TrashView) {
    if (!confirm(`Permanently delete "${t.slug}"? This cannot be undone.`)) return;
    setBusy(t.id);
    setErr(null);
    try {
      const res = await fetch(`/api/sites/${t.id}?permanent=true`, { method: "DELETE" });
      if (!res.ok) setErr("Delete failed.");
      else onChanged();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ marginTop: 34 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <Trash2 size={15} style={{ color: "var(--text-subtle)" }} />
        <h2 style={{ margin: 0, font: "700 15px/1 var(--font-ui)", color: "var(--text-muted)" }}>
          Trash ({trash.length})
        </h2>
      </div>
      {err && (
        <div style={{ marginBottom: 12, padding: "9px 12px", borderRadius: "var(--r-md)", background: "var(--danger-soft)", border: "1px solid var(--danger-border)", color: "var(--text)", font: "500 12.5px/1.4 var(--font-ui)" }}>
          {err}
        </div>
      )}
      <div className="card" style={{ overflow: "hidden", opacity: 0.9 }}>
        {trash.map((t, i) => {
          const daysLeft = Math.max(
            0,
            Math.ceil((new Date(t.purgeAt).getTime() - nowMs) / (24 * 3600 * 1000)),
          );
          return (
            <div
              key={t.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                padding: "12px 16px",
                borderTop: i === 0 ? "none" : "1px solid var(--border)",
              }}
            >
              <div
                style={{
                  width: 52,
                  height: 38,
                  borderRadius: 8,
                  flex: "none",
                  backgroundImage:
                    "repeating-linear-gradient(135deg, var(--surface-3) 0 6px, var(--surface-2) 6px 12px)",
                  border: "1px solid var(--border)",
                  opacity: 0.5,
                  filter: "grayscale(.6)",
                }}
              />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ font: "700 13.5px/1.1 var(--font-ui)", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {t.slug}
                </div>
                <div className="mb-mono" style={{ font: "500 11px/1 var(--font-mono)", color: "var(--text-subtle)", marginTop: 4 }}>
                  {sizeLabel(t.sizeBytes)} · permanently deleted in {daysLeft}d
                </div>
              </div>
              <button onClick={() => restore(t)} disabled={busy !== null} className="btn btn-neutral" style={{ padding: "8px 13px", font: "600 12.5px/1 var(--font-ui)" }}>
                <ArchiveRestore size={14} />
                {busy === t.id ? "Working…" : "Restore"}
              </button>
              <button onClick={() => purge(t)} disabled={busy !== null} className="btn btn-danger" style={{ padding: "8px 13px", font: "600 12.5px/1 var(--font-ui)" }}>
                <Trash2 size={14} />
                Delete forever
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Toast({ message }: { message: string }) {
  return (
    <div
      style={{
        position: "fixed",
        right: 22,
        bottom: 22,
        zIndex: 60,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "12px 15px",
        borderRadius: "var(--r-md)",
        background: "var(--surface-1)",
        border: "1px solid var(--border-strong)",
        boxShadow: "var(--shadow-2)",
        color: "var(--text)",
        font: "600 13px/1 var(--font-ui)",
        animation: "mb-toast-in .2s ease",
      }}
    >
      <span
        style={{
          width: 22,
          height: 22,
          borderRadius: 6,
          background: "var(--success-soft)",
          border: "1px solid var(--success-border)",
          display: "grid",
          placeItems: "center",
          color: "var(--success)",
        }}
      >
        <Check size={13} />
      </span>
      {message}
    </div>
  );
}

function ModalShell({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 70,
        display: "grid",
        placeItems: "center",
        padding: 22,
        background: "color-mix(in srgb, #000 55%, transparent)",
        backdropFilter: "blur(3px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card"
        style={{ width: "100%", maxWidth: 440, padding: "24px 26px", borderColor: "var(--border-strong)", boxShadow: "var(--shadow-3)" }}
      >
        {children}
      </div>
    </div>
  );
}

function DeleteModal({
  site,
  onClose,
  onDone,
}: {
  site: SiteView;
  onClose: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/sites/${site.id}`, { method: "DELETE" });
      if (res.ok) onDone();
      else setErr("Delete failed. Please try again.");
    } catch {
      setErr("Network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell onClose={onClose}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <div style={{ width: 40, height: 40, borderRadius: 11, background: "var(--danger-soft)", border: "1px solid var(--danger-border)", display: "grid", placeItems: "center", color: "var(--danger)", flex: "none" }}>
          <Trash2 size={19} />
        </div>
        <div>
          <div style={{ font: "800 17px/1.15 var(--font-ui)", letterSpacing: "-.02em", color: "var(--text)" }}>Move to trash</div>
          <div style={{ font: "400 12.5px/1 var(--font-ui)", color: "var(--text-muted)", marginTop: 4 }}>Restorable for 7 days.</div>
        </div>
      </div>
      <p style={{ margin: "0 0 18px", font: "400 13.5px/1.5 var(--font-ui)", color: "var(--text-muted)" }}>
        <span className="mb-mono" style={{ color: "var(--text)" }}>/s/{site.slug}</span> stops
        being served immediately. You can restore it from the trash below for 7
        days, after which it is permanently deleted.
      </p>
      {err && <div style={{ marginBottom: 14, color: "var(--danger)", font: "500 12.5px/1.4 var(--font-ui)" }}>{err}</div>}
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <button onClick={onClose} className="btn btn-ghost" disabled={busy} style={{ border: "1px solid var(--border-strong)", color: "var(--text)" }}>
          Cancel
        </button>
        <button onClick={confirm} className="btn btn-danger" disabled={busy}>
          <Trash2 size={14} />
          {busy ? "Moving…" : "Move to trash"}
        </button>
      </div>
    </ModalShell>
  );
}

function ExtendModal({
  site,
  onClose,
  onDone,
}: {
  site: SiteView;
  onClose: () => void;
  onDone: () => void;
}) {
  const [ttl, setTtl] = useState(site.ttlPreset in TTL_LABEL ? site.ttlPreset : "7d");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/sites/${site.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ttl }),
      });
      if (res.ok) onDone();
      else setErr("Extend failed. Please try again.");
    } catch {
      setErr("Network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell onClose={onClose}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <div style={{ width: 40, height: 40, borderRadius: 11, background: "var(--accent-soft)", border: "1px solid var(--accent-border)", display: "grid", placeItems: "center", color: "var(--accent)", flex: "none" }}>
          <TimerReset size={19} />
        </div>
        <div>
          <div style={{ font: "800 17px/1.15 var(--font-ui)", letterSpacing: "-.02em", color: "var(--text)" }}>Extend TTL</div>
          <div style={{ font: "400 12.5px/1 var(--font-ui)", color: "var(--text-muted)", marginTop: 4 }}>
            Reset the countdown from now.
          </div>
        </div>
      </div>
      <label className="lbl">New lifetime</label>
      <div className="seg-group" style={{ marginBottom: 18 }}>
        {(["24h", "7d", "30d"] as const).map((k) => (
          <button key={k} className={`seg${ttl === k ? " active" : ""}`} onClick={() => setTtl(k)}>
            <Clock size={14} />
            {TTL_LABEL[k]}
          </button>
        ))}
      </div>
      {err && <div style={{ marginBottom: 14, color: "var(--danger)", font: "500 12.5px/1.4 var(--font-ui)" }}>{err}</div>}
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <button onClick={onClose} className="btn btn-ghost" disabled={busy} style={{ border: "1px solid var(--border-strong)", color: "var(--text)" }}>
          Cancel
        </button>
        <button onClick={confirm} className="btn btn-primary" disabled={busy}>
          <Check size={14} />
          {busy ? "Saving…" : "Extend TTL"}
        </button>
      </div>
    </ModalShell>
  );
}
