"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Copy,
  Link2,
  Clock,
  Check,
  Mail,
  X,
  Eye,
  Users,
  Lock,
  FileCode2,
  Files,
  Trash2,
  ArchiveRestore,
  AlertTriangle,
  Pencil,
  Home,
  Globe,
  User,
  Building2,
  TimerReset,
  PowerOff,
  RotateCcw,
  Bell,
  Upload,
} from "lucide-react";
import { Banner } from "@/components/ui";

const TTL_LABEL: Record<string, string> = {
  "24h": "24 hours",
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
};
const ALL_TTLS = ["24h", "7d", "30d", "90d"] as const;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export interface ManagedSite {
  id: string;
  slug: string;
  url: string;
  sizeBytes: number;
  pageCount: number;
  ttlPreset: string;
  expiresAt: string;
  createdAt: string;
  trashed: boolean;
  indexName: string;
  visibility: string;
  workspaceName: string | null;
  currentVersion: number;
}

export interface ManagedStats {
  views: number;
  uniqueViewers: number;
  lastViewedAt: string | null;
}

export interface ManagedVersion {
  version: number;
  sizeBytes: number;
  pageCount: number;
  createdBy: string;
  createdAt: string;
}

function sizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function ago(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return `${Math.max(1, Math.floor(ms / 60_000))}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function timeLeft(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "expired";
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return `${Math.max(1, Math.floor(ms / 60_000))}m`;
  if (h < 48) return `${h}h ${Math.floor((ms % 3_600_000) / 60_000)}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

const cardTitle = { font: "700 15px/1 var(--font-ui)", color: "var(--text)" } as const;
const cardSub = {
  font: "400 12px/1.4 var(--font-ui)",
  color: "var(--text-muted)",
  marginTop: 5,
} as const;

export function ManagePanel({
  site,
  viewers: initialViewers,
  stats,
  files,
  versions = [],
  versionLimit = 1,
  allowedTtls = ["24h", "7d"],
}: {
  site: ManagedSite;
  viewers: string[];
  stats: ManagedStats;
  files: { name: string; size: number }[];
  versions?: ManagedVersion[];
  versionLimit?: number;
  allowedTtls?: string[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [ttl, setTtl] = useState(
    allowedTtls.includes(site.ttlPreset)
      ? site.ttlPreset
      : allowedTtls[allowedTtls.length - 1] || "7d",
  );
  const [slugDraft, setSlugDraft] = useState(site.slug);
  const [visibility, setVisibility] = useState(site.visibility);
  const [viewers, setViewers] = useState(initialViewers);
  const [viewerInput, setViewerInput] = useState("");
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  function flash(msg: string) {
    setNotice(msg);
    setError(null);
    setTimeout(() => setNotice(null), 2500);
  }

  async function call(
    key: string,
    fn: () => Promise<Response>,
    okMsg: string,
  ): Promise<boolean> {
    setBusy(key);
    setError(null);
    try {
      const res = await fn();
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Request failed.");
        return false;
      }
      flash(okMsg);
      router.refresh();
      return true;
    } catch {
      setError("Network error.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  const patch = (body: Record<string, unknown>) => () =>
    fetch(`/api/sites/${site.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${site.url}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  const saveTtl = () => call("ttl", patch({ ttl }), "TTL reset from now.");
  const extendTtl = () =>
    call("extend", patch({ ttl: site.ttlPreset }), "Countdown reset from now.");
  const saveSlug = () =>
    call("slug", patch({ slug: slugDraft }), "Slug renamed — old links stop resolving.");

  function setVis(value: string, okMsg: string) {
    setVisibility(value);
    call("visibility", patch({ visibility: value }), okMsg);
  }

  const setIndex = (name: string) =>
    call(`index-${name}`, patch({ index: name }), `${name} is now the index page.`);

  const rollback = (version: number) =>
    call(
      `rollback-${version}`,
      () =>
        fetch(`/api/sites/${site.id}/versions/rollback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ version }),
        }),
      `Rolled back to v${version}.`,
    );

  const forceExpire = () =>
    call(
      "force-expire",
      patch({ action: "force_expire" }),
      "Site expired — serving stopped.",
    );

  async function addViewer() {
    const email = viewerInput.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      setError("Enter a valid email address.");
      return;
    }
    const ok = await call(
      "viewer-add",
      () =>
        fetch(`/api/sites/${site.id}/viewers`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        }),
      `${email} can now view this site.`,
    );
    if (ok) {
      setViewers((v) => (v.includes(email) ? v : [...v, email].sort()));
      setViewerInput("");
    }
  }

  async function removeViewer(email: string) {
    const ok = await call(
      `viewer-del-${email}`,
      () =>
        fetch(`/api/sites/${site.id}/viewers`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        }),
      `${email} removed — access revoked.`,
    );
    if (ok) setViewers((v) => v.filter((x) => x !== email));
  }

  const trash = () =>
    call(
      "trash",
      () => fetch(`/api/sites/${site.id}`, { method: "DELETE" }),
      "Moved to trash.",
    );

  const restore = () =>
    call("restore", patch({ action: "restore" }), "Site restored.");

  async function purge() {
    if (!confirm(`Permanently delete "${site.slug}"? This cannot be undone.`)) return;
    const ok = await call(
      "purge",
      () => fetch(`/api/sites/${site.id}?permanent=true`, { method: "DELETE" }),
      "Deleted forever.",
    );
    if (ok) router.push("/dashboard");
  }

  const expired = new Date(site.expiresAt).getTime() <= Date.now();
  const isPublic = visibility === "public";
  const radioVis = isPublic ? null : visibility;

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "28px 30px 100px" }}>
      <div style={{ marginBottom: 14 }}>
        <Link
          href="/dashboard"
          className="btn btn-ghost"
          style={{ padding: "5px 9px", font: "600 12px/1 var(--font-ui)" }}
        >
          <ArrowLeft size={14} />
          Sites
        </Link>
      </div>

      {/* header: slug + status + URL chip | actions */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 20,
          flexWrap: "wrap",
          marginBottom: 24,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 11,
              flexWrap: "wrap",
              marginBottom: 9,
            }}
          >
            <h1
              style={{
                margin: 0,
                font: "800 25px/1 var(--font-ui)",
                letterSpacing: "-.02em",
                color: "var(--text)",
              }}
            >
              {site.slug}
            </h1>
            {site.trashed ? (
              <span className="pill pill-danger">
                <Trash2 size={12} style={{ color: "var(--danger)" }} />
                <span className="mb-mono" style={{ color: "var(--danger)" }}>IN TRASH</span>
              </span>
            ) : expired ? (
              <span className="pill pill-danger">
                <PowerOff size={12} style={{ color: "var(--danger)" }} />
                <span className="mb-mono" style={{ color: "var(--danger)" }}>EXPIRED</span>
              </span>
            ) : (
              <span className="pill pill-success">
                <Clock size={12} style={{ color: "var(--success)" }} />
                <span className="mb-mono">{timeLeft(site.expiresAt).toUpperCase()} LEFT</span>
              </span>
            )}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              padding: "8px 11px",
              borderRadius: 9,
              background: "var(--surface-2)",
              border: "1px solid var(--border-strong)",
              maxWidth: "100%",
            }}
          >
            <Link2 size={13} style={{ color: "var(--text-subtle)", flex: "none" }} />
            <a
              href={site.url}
              target="_blank"
              rel="noreferrer"
              className="mb-mono"
              style={{
                font: "500 12.5px/1 var(--font-mono)",
                color: "var(--text-muted)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {origin ? `${origin}${site.url}` : site.url}
            </a>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
          <button onClick={copyLink} className="btn btn-neutral">
            <Copy size={14} />
            {copied ? "Copied" : "Copy link"}
          </button>
          {!site.trashed && (
            <Link
              href={`/upload?slug=${encodeURIComponent(site.slug)}`}
              className="btn btn-neutral"
              title="Upload new content at the same URL"
            >
              <Pencil size={14} />
              Edit
            </Link>
          )}
          <button
            onClick={extendTtl}
            disabled={busy !== null || site.trashed}
            className="btn btn-primary"
          >
            <TimerReset size={14} />
            {busy === "extend" ? "Extending…" : "Extend TTL"}
          </button>
        </div>
      </div>

      {(notice || error) && (
        <div style={{ marginBottom: 16 }}>
          <Banner tone={error ? "danger" : "success"}>{error || notice}</Banner>
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.45fr 1fr",
          gap: 20,
          alignItems: "start",
        }}
      >
        {/* ============================== left column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* stats */}
          <div className="card" style={{ padding: 20 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 }}>
              <Stat icon={<Eye size={15} />} label="Views" value={String(stats.views)} />
              <Stat
                icon={<Users size={15} />}
                label="Unique viewers"
                value={String(stats.uniqueViewers)}
              />
              <Stat
                icon={<Clock size={15} />}
                label="Last viewed"
                value={ago(stats.lastViewedAt)}
              />
            </div>
          </div>

          {/* pages */}
          {files.length > 0 && (
            <div className="card" style={{ overflow: "hidden" }}>
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
                  <div style={cardTitle}>Pages</div>
                  <div style={cardSub}>
                    {files.length} HTML file{files.length > 1 ? "s" : ""} served under one
                    slug.
                  </div>
                </div>
                {files.length > 1 && (
                  <span className="pill">
                    <Files size={11} />
                    <span className="mb-mono">MULTI-PAGE</span>
                  </span>
                )}
              </div>
              {files.map((f) => {
                const isIndex = f.name === site.indexName;
                return (
                  <div
                    key={f.name}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "13px 20px",
                      borderTop: "1px solid var(--border)",
                    }}
                  >
                    <FileCode2
                      size={16}
                      style={{ color: "var(--text-subtle)", flex: "none" }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <a
                          href={isIndex ? site.url : `${site.url}/${f.name}`}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            font: "600 13px/1.2 var(--font-ui)",
                            color: "var(--text)",
                          }}
                        >
                          {f.name}
                        </a>
                        {isIndex && (
                          <span className="pill pill-accent">
                            <Home size={10} />
                            <span className="mb-mono">INDEX</span>
                          </span>
                        )}
                      </div>
                      <div
                        className="mb-mono"
                        style={{
                          font: "500 11px/1 var(--font-mono)",
                          color: "var(--text-subtle)",
                          marginTop: 4,
                        }}
                      >
                        {isIndex ? `${site.url}/` : `${site.url}/${f.name}`}
                      </div>
                    </div>
                    <span
                      className="mb-mono"
                      style={{
                        font: "500 11px/1 var(--font-mono)",
                        color: "var(--text-subtle)",
                        flex: "none",
                      }}
                    >
                      {sizeLabel(f.size)}
                    </span>
                    {!isIndex && (
                      <button
                        onClick={() => setIndex(f.name)}
                        disabled={busy !== null}
                        className="btn btn-ghost"
                        style={{ padding: "6px 10px", font: "600 11.5px/1 var(--font-ui)" }}
                      >
                        Set as index
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* versions */}
          <div className="card" style={{ overflow: "hidden" }}>
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
                <div style={cardTitle}>Versions</div>
                <div style={cardSub}>
                  {versionLimit > 1
                    ? `Re-uploads keep the same URL. Last ${versionLimit} retained.`
                    : "Re-uploads keep the same URL and replace the content."}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flex: "none" }}>
                <span
                  className="mb-mono"
                  style={{
                    font: "600 10.5px/1 var(--font-mono)",
                    color: "var(--text-subtle)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {Math.min(versions.length, versionLimit)} / {versionLimit} KEPT
                </span>
                {!site.trashed && (
                  <Link
                    href={`/upload?slug=${encodeURIComponent(site.slug)}`}
                    className="btn btn-ghost"
                    style={{
                      padding: "6px 10px",
                      font: "600 11.5px/1 var(--font-ui)",
                      border: "1px solid var(--border-strong)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <Upload size={12} />
                    New version
                  </Link>
                )}
              </div>
            </div>
            {versions.length === 0 && (
              <div
                style={{
                  padding: "18px 20px",
                  font: "400 12.5px/1.5 var(--font-ui)",
                  color: "var(--text-muted)",
                }}
              >
                Version history appears after the first re-upload to this slug.
              </div>
            )}
            {versions.map((v) => {
              const current = v.version === site.currentVersion;
              return (
                <div
                  key={v.version}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 13,
                    padding: "13px 20px",
                    borderTop: "1px solid var(--border)",
                  }}
                >
                  <span
                    className={`pill ${current ? "pill-success" : ""}`}
                    style={{ width: 44, justifyContent: "center" }}
                  >
                    <span className="mb-mono">v{v.version}</span>
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ font: "600 12.5px/1.2 var(--font-ui)", color: "var(--text)" }}>
                      {new Date(v.createdAt).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                    <div
                      className="mb-mono"
                      style={{
                        font: "500 11px/1 var(--font-mono)",
                        color: "var(--text-subtle)",
                        marginTop: 4,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {v.createdBy} · {sizeLabel(v.sizeBytes)} · {v.pageCount} page
                      {v.pageCount > 1 ? "s" : ""}
                    </div>
                  </div>
                  <button
                    onClick={() => !current && rollback(v.version)}
                    disabled={busy !== null || current}
                    className="btn btn-ghost"
                    style={{
                      padding: "7px 11px",
                      font: "600 11.5px/1 var(--font-ui)",
                      ...(current ? { opacity: 0.55, cursor: "default" } : {}),
                    }}
                  >
                    {current ? <Check size={13} /> : <RotateCcw size={13} />}
                    {current ? "Current" : "Roll back"}
                  </button>
                </div>
              );
            })}
            {versionLimit === 1 && (
              <div
                style={{
                  padding: "12px 20px",
                  borderTop: "1px solid var(--border)",
                  background: "var(--surface-2)",
                }}
              >
                <span
                  className="mb-mono"
                  style={{ font: "500 11px/1.4 var(--font-mono)", color: "var(--text-subtle)" }}
                >
                  The Team plan keeps the last 5 versions with instant rollback.
                </span>
              </div>
            )}
          </div>

          {/* slug rename */}
          <div className="card" style={{ padding: 20 }}>
            <div style={cardTitle}>Site URL</div>
            <div style={{ ...cardSub, marginBottom: 15 }}>
              Renaming changes the link immediately — anyone holding the old URL loses it.
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <div
                className="focus-ring"
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "stretch",
                  borderRadius: "var(--r-md)",
                  background: "var(--surface-2)",
                  border: "1px solid var(--border-strong)",
                  overflow: "hidden",
                }}
              >
                <span
                  className="mb-mono"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    padding: "0 12px",
                    font: "500 13px/1 var(--font-mono)",
                    color: "var(--text-subtle)",
                    background: "color-mix(in srgb, var(--surface-3) 60%, transparent)",
                    borderRight: "1px solid var(--border)",
                  }}
                >
                  /s/
                </span>
                <input
                  value={slugDraft}
                  onChange={(e) => setSlugDraft(e.target.value)}
                  className="mb-mono"
                  style={{
                    flex: 1,
                    minWidth: 0,
                    padding: "11px 12px",
                    border: "none",
                    background: "transparent",
                    color: "var(--text)",
                    font: "500 13.5px/1 var(--font-mono)",
                    outline: "none",
                  }}
                />
              </div>
              <button
                onClick={saveSlug}
                disabled={busy !== null || slugDraft === site.slug}
                className="btn btn-neutral"
              >
                <Pencil size={14} />
                {busy === "slug" ? "Renaming…" : "Rename"}
              </button>
            </div>
          </div>
        </div>

        {/* ============================== right column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* who can view */}
          <div className="card" style={{ padding: 20 }}>
            <div style={cardTitle}>Who can view</div>
            <div style={{ ...cardSub, marginBottom: 15 }}>
              Enforced server-side before any byte is served.
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                marginBottom: 16,
                opacity: isPublic ? 0.5 : 1,
              }}
            >
              {(
                [
                  ["only_me", "Only me", User],
                  ["allowlist", "Specific people", Mail],
                  [
                    "team",
                    site.workspaceName ? `Everyone at ${site.workspaceName}` : "Whole team",
                    Building2,
                  ],
                ] as const
              ).map(([value, label, Icon]) => {
                const active = radioVis === value;
                const disabled =
                  (value === "team" && !site.workspaceName) || isPublic || busy !== null;
                return (
                  <button
                    key={value}
                    disabled={disabled}
                    title={
                      value === "team" && !site.workspaceName
                        ? "Team visibility requires a workspace site"
                        : undefined
                    }
                    onClick={() => setVis(value, "Visibility updated.")}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      width: "100%",
                      padding: "10px 12px",
                      borderRadius: "var(--r-md)",
                      font: "600 12.5px/1 var(--font-ui)",
                      cursor: disabled ? "not-allowed" : "pointer",
                      background: active ? "var(--accent-soft)" : "var(--surface-2)",
                      border: `1px solid ${active ? "var(--accent-border)" : "var(--border)"}`,
                      color: "var(--text)",
                      opacity: value === "team" && !site.workspaceName ? 0.5 : 1,
                    }}
                  >
                    <Icon size={15} style={{ color: active ? "var(--accent)" : "var(--text-subtle)" }} />
                    <span style={{ flex: 1, textAlign: "left" }}>{label}</span>
                    {active && <Check size={14} style={{ color: "var(--accent)" }} />}
                  </button>
                );
              })}
            </div>

            {visibility === "allowlist" && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  paddingTop: 14,
                  borderTop: "1px solid var(--border)",
                  marginBottom: 16,
                }}
              >
                {viewers.map((v) => (
                  <div key={v} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span
                      style={{
                        display: "grid",
                        placeItems: "center",
                        width: 26,
                        height: 26,
                        borderRadius: 999,
                        background: "var(--accent-soft)",
                        border: "1px solid var(--accent-border)",
                        color: "var(--text)",
                        font: "700 10px/1 var(--font-ui)",
                        flex: "none",
                      }}
                    >
                      {v.slice(0, 2).toUpperCase()}
                    </span>
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        font: "600 12.5px/1.2 var(--font-ui)",
                        color: "var(--text)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {v}
                    </span>
                    <button
                      onClick={() => removeViewer(v)}
                      disabled={busy !== null}
                      aria-label={`Remove ${v}`}
                      className="icon-btn"
                      style={{ width: 26, height: 26 }}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
                {viewers.length === 0 && (
                  <span style={{ font: "500 12px/1.4 var(--font-ui)", color: "var(--text-subtle)" }}>
                    No viewers yet — only you can open this site.
                  </span>
                )}
                <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                  <input
                    value={viewerInput}
                    onChange={(e) => setViewerInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") addViewer();
                    }}
                    placeholder="name@company.com"
                    className="field"
                    style={{ flex: 1, padding: "8px 10px", font: "500 12.5px/1 var(--font-ui)" }}
                  />
                  <button
                    onClick={addViewer}
                    disabled={busy !== null || !viewerInput.trim()}
                    className="btn btn-primary"
                    style={{ padding: "8px 12px", font: "600 12px/1 var(--font-ui)" }}
                  >
                    {busy === "viewer-add" ? "Adding…" : "Add"}
                  </button>
                </div>
              </div>
            )}

            {/* public toggle */}
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
                paddingTop: 15,
                borderTop: "1px solid var(--border)",
              }}
            >
              <Globe
                size={16}
                style={{ color: "var(--warning)", flex: "none", marginTop: 2 }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ font: "600 12.5px/1.2 var(--font-ui)", color: "var(--text)" }}>
                  Anyone with the link
                </div>
                <div style={{ font: "400 11.5px/1.4 var(--font-ui)", color: "var(--text-muted)", marginTop: 3 }}>
                  Unauthenticated access. Off by default.
                </div>
              </div>
              <button
                onClick={() =>
                  isPublic
                    ? setVis("allowlist", "Login wall restored.")
                    : setVis("public", "Site is now public to anyone with the URL.")
                }
                disabled={busy !== null}
                aria-label="Toggle public access"
                style={{
                  position: "relative",
                  width: 38,
                  height: 22,
                  borderRadius: 999,
                  border: `1px solid ${isPublic ? "var(--warning-border)" : "var(--border-strong)"}`,
                  background: isPublic ? "var(--warning)" : "var(--surface-3)",
                  cursor: "pointer",
                  flex: "none",
                  transition: "background .15s",
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    top: 2,
                    left: isPublic ? 18 : 2,
                    width: 16,
                    height: 16,
                    borderRadius: 999,
                    background: "#fff",
                    transition: "left .15s",
                  }}
                />
              </button>
            </div>
            {isPublic && (
              <div style={{ marginTop: 12 }}>
                <Banner
                  tone="warning"
                  icon={<AlertTriangle size={15} style={{ color: "var(--warning)", flex: "none" }} />}
                >
                  This site is public. Anyone with the URL can read it.
                </Banner>
              </div>
            )}
          </div>

          {/* lifecycle */}
          <div className="card" style={{ padding: 20 }}>
            <div style={{ ...cardTitle, marginBottom: 15 }}>Lifecycle</div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 11,
                font: "500 12px/1 var(--font-ui)",
                color: "var(--text-muted)",
                marginBottom: 16,
              }}
            >
              <LifeRow label="Expires">
                <span className="mb-mono" style={{ color: expired ? "var(--danger)" : "var(--warning)" }}>
                  {expired ? "expired" : `in ${timeLeft(site.expiresAt)}`}
                </span>
              </LifeRow>
              <LifeRow label="Then">
                <span className="mb-mono" style={{ color: "var(--text)" }}>7-day trash</span>
              </LifeRow>
              <LifeRow label="Total size">
                <span className="mb-mono" style={{ color: "var(--text)" }}>
                  {sizeLabel(site.sizeBytes)}
                </span>
              </LifeRow>
              <LifeRow label="Created">
                <span className="mb-mono" style={{ color: "var(--text)" }}>
                  {ago(site.createdAt)}
                </span>
              </LifeRow>
            </div>
            <div className="seg-group" style={{ marginBottom: 10 }}>
              {ALL_TTLS.map((k) => {
                const locked = !allowedTtls.includes(k);
                return (
                  <button
                    key={k}
                    className={`seg${ttl === k ? " active" : ""}`}
                    disabled={locked}
                    style={{
                      padding: "8px 4px",
                      font: "600 12px/1 var(--font-ui)",
                      ...(locked ? { opacity: 0.45, cursor: "not-allowed" } : {}),
                    }}
                    title={locked ? "Longer TTLs require the Team plan" : undefined}
                    onClick={() => setTtl(k)}
                  >
                    {TTL_LABEL[k]}
                  </button>
                );
              })}
            </div>
            <button
              onClick={saveTtl}
              disabled={busy !== null}
              className="btn btn-primary"
              style={{ width: "100%" }}
            >
              <Check size={14} />
              {busy === "ttl" ? "Saving…" : "Save — resets countdown"}
            </button>
            <div className="hint" style={{ marginTop: 13, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
              <Bell size={12} />
              You&apos;ll be alerted at T-48h and T-2h.
            </div>
          </div>

          {/* danger zone */}
          <div className="card" style={{ padding: 20, borderColor: "var(--danger-border)" }}>
            <div style={{ font: "700 14px/1 var(--font-ui)", color: "var(--danger)", marginBottom: 14 }}>
              Danger zone
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              {site.trashed ? (
                <>
                  <button
                    onClick={restore}
                    disabled={busy !== null}
                    className="btn btn-primary"
                    style={{ width: "100%" }}
                  >
                    <ArchiveRestore size={14} />
                    {busy === "restore" ? "Restoring…" : "Restore site"}
                  </button>
                  <button
                    onClick={purge}
                    disabled={busy !== null}
                    className="btn btn-danger"
                    style={{ width: "100%" }}
                  >
                    <Trash2 size={14} />
                    {busy === "purge" ? "Deleting…" : "Delete forever"}
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={forceExpire}
                    disabled={busy !== null || expired}
                    className="btn btn-neutral"
                    style={{ width: "100%" }}
                  >
                    <PowerOff size={14} />
                    {busy === "force-expire" ? "Expiring…" : "Force-expire now"}
                  </button>
                  <button
                    onClick={trash}
                    disabled={busy !== null}
                    className="btn btn-danger"
                    style={{ width: "100%" }}
                  >
                    <Trash2 size={14} />
                    {busy === "trash" ? "Moving…" : "Move to trash"}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function LifeRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
      }}
    >
      <span>{label}</span>
      {children}
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div
      style={{
        padding: "14px 16px",
        borderRadius: "var(--r-md)",
        background: "var(--surface-2)",
        border: "1px solid var(--border)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          color: "var(--text-subtle)",
          marginBottom: 8,
        }}
      >
        {icon}
        <span
          className="mb-mono"
          style={{ font: "600 10.5px/1 var(--font-mono)", letterSpacing: ".12em", textTransform: "uppercase" }}
        >
          {label}
        </span>
      </div>
      <div style={{ font: "800 19px/1 var(--font-ui)", color: "var(--text)" }}>{value}</div>
    </div>
  );
}
