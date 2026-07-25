"use client";

import { useState } from "react";
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
  Trash2,
  ArchiveRestore,
  AlertTriangle,
  Pencil,
  Home,
} from "lucide-react";

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
}

export interface ManagedStats {
  views: number;
  uniqueViewers: number;
  lastViewedAt: string | null;
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

export function ManagePanel({
  site,
  viewers: initialViewers,
  stats,
  files,
  allowedTtls = ["24h", "7d"],
}: {
  site: ManagedSite;
  viewers: string[];
  stats: ManagedStats;
  files: { name: string; size: number }[];
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

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(site.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  const saveTtl = () =>
    call(
      "ttl",
      () =>
        fetch(`/api/sites/${site.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ttl }),
        }),
      "TTL reset from now.",
    );

  const saveSlug = () =>
    call(
      "slug",
      () =>
        fetch(`/api/sites/${site.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug: slugDraft }),
        }),
      "Slug renamed — old links stop resolving.",
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
    call(
      "restore",
      () =>
        fetch(`/api/sites/${site.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "restore" }),
        }),
      "Site restored.",
    );

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

  return (
    <div style={{ maxWidth: 780, margin: "0 auto", padding: "34px 30px 100px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <Link href="/dashboard" className="btn btn-ghost" style={{ padding: "5px 9px", font: "600 12px/1 var(--font-ui)" }}>
          <ArrowLeft size={14} />
          Sites
        </Link>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
        <h1 style={{ margin: 0, font: "800 26px/1 var(--font-ui)", letterSpacing: "-.02em", color: "var(--text)" }}>
          {site.slug}
        </h1>
        {site.trashed ? (
          <span style={{ padding: "4px 11px", borderRadius: 999, background: "var(--danger-soft)", border: "1px solid var(--danger-border)", color: "var(--danger)", font: "600 11px/1 var(--font-ui)" }}>
            In trash
          </span>
        ) : expired ? (
          <span style={{ padding: "4px 11px", borderRadius: 999, background: "var(--danger-soft)", border: "1px solid var(--danger-border)", color: "var(--danger)", font: "600 11px/1 var(--font-ui)" }}>
            Expired
          </span>
        ) : (
          <span style={{ padding: "4px 11px", borderRadius: 999, background: "var(--success-soft)", border: "1px solid var(--success-border)", color: "var(--success)", font: "600 11px/1 var(--font-ui)" }}>
            Live
          </span>
        )}
      </div>
      <p style={{ margin: "0 0 22px", font: "400 13px/1 var(--font-ui)", color: "var(--text-muted)" }}>
        Created {ago(site.createdAt)} · {site.pageCount} page{site.pageCount > 1 ? "s" : ""} · {sizeLabel(site.sizeBytes)}
      </p>

      {(notice || error) && (
        <div
          style={{
            marginBottom: 16,
            padding: "10px 13px",
            borderRadius: "var(--r-md)",
            background: error ? "var(--danger-soft)" : "var(--success-soft)",
            border: `1px solid ${error ? "var(--danger-border)" : "var(--success-border)"}`,
            color: "var(--text)",
            font: "500 12.5px/1.4 var(--font-ui)",
          }}
        >
          {error || notice}
        </div>
      )}

      {/* link + stats */}
      <div className="card" style={{ padding: 24, marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "11px 12px", borderRadius: "var(--r-md)", background: "var(--surface-2)", border: "1px solid var(--border-strong)", marginBottom: 18 }}>
          <Link2 size={14} style={{ color: "var(--accent)", flex: "none" }} />
          <a href={site.url} target="_blank" rel="noreferrer" className="mb-mono" style={{ flex: 1, font: "500 13px/1 var(--font-mono)", color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {site.url}
          </a>
          <button onClick={copyLink} className="btn btn-primary" style={{ padding: "7px 12px", font: "600 12px/1 var(--font-ui)", flex: "none" }}>
            <Copy size={13} />
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 }}>
          <Stat icon={<Eye size={15} />} label="Views" value={String(stats.views)} />
          <Stat icon={<Users size={15} />} label="Unique viewers" value={String(stats.uniqueViewers)} />
          <Stat icon={<Clock size={15} />} label="Last viewed" value={ago(stats.lastViewedAt)} />
        </div>
      </div>

      {/* lifetime */}
      <div className="card" style={{ padding: 24, marginBottom: 18 }}>
        <div style={{ font: "700 15px/1 var(--font-ui)", color: "var(--text)", marginBottom: 5 }}>Lifetime</div>
        <div style={{ font: "400 12.5px/1.5 var(--font-ui)", color: "var(--text-muted)", marginBottom: 16 }}>
          Saving resets the countdown from now.
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <div className="seg-group" style={{ flex: 1 }}>
            {ALL_TTLS.map((k) => {
              const locked = !allowedTtls.includes(k);
              return (
                <button
                  key={k}
                  className={`seg${ttl === k ? " active" : ""}`}
                  disabled={locked}
                  style={locked ? { opacity: 0.45, cursor: "not-allowed" } : undefined}
                  title={locked ? "Longer TTLs require the Team plan" : undefined}
                  onClick={() => setTtl(k)}
                >
                  <Clock size={14} />
                  {TTL_LABEL[k]}
                </button>
              );
            })}
          </div>
          <button onClick={saveTtl} disabled={busy !== null} className="btn btn-primary">
            <Check size={14} />
            {busy === "ttl" ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {/* slug */}
      <div className="card" style={{ padding: 24, marginBottom: 18 }}>
        <div style={{ font: "700 15px/1 var(--font-ui)", color: "var(--text)", marginBottom: 5 }}>Site URL</div>
        <div style={{ font: "400 12.5px/1.5 var(--font-ui)", color: "var(--text-muted)", marginBottom: 16 }}>
          Renaming changes the link immediately — anyone holding the old URL loses it.
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <div className="focus-ring" style={{ flex: 1, display: "flex", alignItems: "stretch", borderRadius: "var(--r-md)", background: "var(--surface-2)", border: "1px solid var(--border-strong)", overflow: "hidden" }}>
            <span className="mb-mono" style={{ display: "flex", alignItems: "center", padding: "0 12px", font: "500 13px/1 var(--font-mono)", color: "var(--text-subtle)", background: "color-mix(in srgb, var(--surface-3) 60%, transparent)", borderRight: "1px solid var(--border)" }}>
              /s/
            </span>
            <input
              value={slugDraft}
              onChange={(e) => setSlugDraft(e.target.value)}
              className="mb-mono"
              style={{ flex: 1, minWidth: 0, padding: "11px 12px", border: "none", background: "transparent", color: "var(--text)", font: "500 13.5px/1 var(--font-mono)", outline: "none" }}
            />
          </div>
          <button onClick={saveSlug} disabled={busy !== null || slugDraft === site.slug} className="btn btn-neutral">
            <Pencil size={14} />
            {busy === "slug" ? "Renaming…" : "Rename"}
          </button>
        </div>
      </div>

      {/* visibility */}
      <div className="card" style={{ padding: 24, marginBottom: 18 }}>
        <div style={{ font: "700 15px/1 var(--font-ui)", color: "var(--text)", marginBottom: 5 }}>Who can view</div>
        <div style={{ font: "400 12.5px/1.5 var(--font-ui)", color: "var(--text-muted)", marginBottom: 16 }}>
          {site.workspaceName
            ? `This site lives in the "${site.workspaceName}" workspace.`
            : "Personal site — move-to-workspace is not supported yet; pick the audience below."}
        </div>
        <div className="seg-group">
          {(
            [
              ["only_me", "Only me", Lock],
              ["allowlist", "Specific people", Mail],
              ["team", "Whole team", Users],
            ] as const
          ).map(([value, label, Icon]) => {
            const disabled = value === "team" && !site.workspaceName;
            return (
              <button
                key={value}
                className={`seg${visibility === value ? " active" : ""}`}
                disabled={disabled || busy !== null}
                style={disabled ? { opacity: 0.45, cursor: "not-allowed" } : undefined}
                title={disabled ? "Team visibility requires a workspace site" : undefined}
                onClick={() => {
                  setVisibility(value);
                  call(
                    "visibility",
                    () =>
                      fetch(`/api/sites/${site.id}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ visibility: value }),
                      }),
                    "Visibility updated.",
                  );
                }}
              >
                <Icon size={14} />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* viewers */}
      {visibility === "allowlist" && (
      <div className="card" style={{ padding: 24, marginBottom: 18 }}>
        <div style={{ font: "700 15px/1 var(--font-ui)", color: "var(--text)", marginBottom: 5 }}>Allowed viewers</div>
        <div style={{ font: "400 12.5px/1.5 var(--font-ui)", color: "var(--text-muted)", marginBottom: 16 }}>
          Changes take effect immediately — removing someone revokes access on their next request. You always have access as the owner.
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: viewers.length ? 14 : 0 }}>
          {viewers.map((v) => (
            <span key={v} style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "6px 9px 6px 12px", borderRadius: 999, background: "var(--accent-soft)", border: "1px solid var(--accent-border)", color: "var(--text)", font: "500 12.5px/1 var(--font-ui)" }}>
              <Mail size={12} style={{ color: "var(--accent)" }} />
              {v}
              <button
                onClick={() => removeViewer(v)}
                disabled={busy !== null}
                aria-label={`Remove ${v}`}
                style={{ display: "grid", placeItems: "center", width: 17, height: 17, borderRadius: 999, border: "none", background: "transparent", color: "var(--text-muted)", cursor: "pointer" }}
              >
                <X size={12} />
              </button>
            </span>
          ))}
          {viewers.length === 0 && (
            <span style={{ font: "500 12.5px/1 var(--font-ui)", color: "var(--text-subtle)" }}>
              Only you can view this site.
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <input
            value={viewerInput}
            onChange={(e) => setViewerInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addViewer();
            }}
            placeholder="name@company.com"
            className="field"
            style={{ flex: 1 }}
          />
          <button onClick={addViewer} disabled={busy !== null || !viewerInput.trim()} className="btn btn-primary">
            {busy === "viewer-add" ? "Adding…" : "Add viewer"}
          </button>
        </div>
      </div>
      )}

      {/* pages */}
      {files.length > 0 && (
        <div className="card" style={{ padding: 24, marginBottom: 18 }}>
          <div style={{ font: "700 15px/1 var(--font-ui)", color: "var(--text)", marginBottom: 14 }}>Pages</div>
          {files.map((f, i) => (
            <div key={f.name} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 0", borderTop: i === 0 ? "none" : "1px solid var(--border)" }}>
              <FileCode2 size={16} style={{ color: "var(--text-muted)", flex: "none" }} />
              <a
                href={f.name === site.indexName ? site.url : `${site.url}/${f.name}`}
                target="_blank"
                rel="noreferrer"
                className="mb-mono"
                style={{ flex: 1, font: "500 12.5px/1 var(--font-mono)", color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              >
                {f.name}
              </a>
              {f.name === site.indexName && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 8px", borderRadius: 999, background: "var(--accent-soft)", border: "1px solid var(--accent-border)", color: "var(--text)", font: "600 10px/1 var(--font-ui)" }}>
                  <Home size={10} />
                  index
                </span>
              )}
              <span className="mb-mono" style={{ font: "500 11px/1 var(--font-mono)", color: "var(--text-subtle)", flex: "none" }}>
                {sizeLabel(f.size)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* danger zone */}
      <div className="card" style={{ padding: 24, borderColor: "var(--danger-border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, font: "700 15px/1 var(--font-ui)", color: "var(--text)", marginBottom: 5 }}>
          <AlertTriangle size={15} style={{ color: "var(--danger)" }} />
          Danger zone
        </div>
        <div style={{ font: "400 12.5px/1.5 var(--font-ui)", color: "var(--text-muted)", marginBottom: 16 }}>
          {site.trashed
            ? "This site is in the trash. It stops being served and will be permanently deleted after 7 days."
            : "Trashed sites stop being served immediately but can be restored for 7 days."}
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {site.trashed ? (
            <>
              <button onClick={restore} disabled={busy !== null} className="btn btn-primary">
                <ArchiveRestore size={14} />
                {busy === "restore" ? "Restoring…" : "Restore site"}
              </button>
              <button onClick={purge} disabled={busy !== null} className="btn btn-danger">
                <Trash2 size={14} />
                {busy === "purge" ? "Deleting…" : "Delete forever"}
              </button>
            </>
          ) : (
            <button onClick={trash} disabled={busy !== null} className="btn btn-danger">
              <Trash2 size={14} />
              {busy === "trash" ? "Moving…" : "Move to trash"}
            </button>
          )}
        </div>
      </div>
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
    <div style={{ padding: "14px 16px", borderRadius: "var(--r-md)", background: "var(--surface-2)", border: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, color: "var(--text-subtle)", marginBottom: 8 }}>
        {icon}
        <span className="mb-mono" style={{ font: "600 10.5px/1 var(--font-mono)", letterSpacing: ".12em", textTransform: "uppercase" }}>{label}</span>
      </div>
      <div style={{ font: "800 19px/1 var(--font-ui)", color: "var(--text)" }}>{value}</div>
    </div>
  );
}
