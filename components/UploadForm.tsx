"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  UploadCloud,
  FileCode2,
  X,
  Wand2,
  Clock,
  Mail,
  Shield,
  Lock,
  Users,
  Timer,
  Rocket,
  Check,
  Copy,
  Link2,
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
const MAX_PAGES = 20;

export interface UploadWorkspace {
  id: string;
  name: string;
  plan: string;
  allowedTtls: string[];
}

export function UploadForm({
  workspaces = [],
  personalTtls = ["24h", "7d", "30d"],
}: {
  workspaces?: UploadWorkspace[];
  personalTtls?: string[];
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [host, setHost] = useState("/s/");
  const [files, setFiles] = useState<File[]>([]);
  const [indexName, setIndexName] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [slug, setSlug] = useState("");
  const [ttl, setTtl] = useState<string>("7d");
  const [dest, setDest] = useState(""); // "" = personal, else workspace id
  const [visibility, setVisibility] = useState<"only_me" | "allowlist" | "team">("allowlist");

  const destWorkspace = workspaces.find((w) => w.id === dest) || null;
  const allowedTtls = destWorkspace ? destWorkspace.allowedTtls : personalTtls;
  const teamLocked = Boolean(destWorkspace && destWorkspace.plan !== "team");
  const [chips, setChips] = useState<string[]>([]);
  const [chipInput, setChipInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [published, setPublished] = useState<{
    slug: string;
    url: string;
    pages: number;
  } | null>(null);

  const FALLBACK_MAX = 4 * 1024 * 1024; // multipart route cap

  useEffect(() => {
    setHost(`${window.location.host}/s/`);
  }, []);

  function addFiles(incoming: FileList | File[] | null) {
    setError(null);
    if (!incoming) return;
    const next = [...files];
    for (const f of Array.from(incoming)) {
      if (!f.name.toLowerCase().match(/\.html?$/) && f.type !== "text/html") {
        setError(`"${f.name}" skipped — only .html files are accepted.`);
        continue;
      }
      if (next.some((x) => x.name === f.name)) continue; // dedupe by name
      if (next.length >= MAX_PAGES) {
        setError(`At most ${MAX_PAGES} pages per site.`);
        break;
      }
      next.push(f);
    }
    setFiles(next);
    autoPickIndex(next, indexName);
  }

  function removeFile(name: string) {
    const next = files.filter((f) => f.name !== name);
    setFiles(next);
    autoPickIndex(next, indexName === name ? null : indexName);
  }

  /** Keep a sensible index selection as the file list changes. */
  function autoPickIndex(list: File[], current: string | null) {
    if (list.length === 0) return setIndexName(null);
    if (current && list.some((f) => f.name === current)) return setIndexName(current);
    const auto = list.find((f) => f.name.toLowerCase() === "index.html");
    setIndexName(auto ? auto.name : list.length === 1 ? list[0].name : null);
  }

  function commitChip() {
    const v = chipInput.trim().toLowerCase();
    if (!v) return;
    if (!EMAIL_RE.test(v)) {
      setError("Enter a valid email address.");
      return;
    }
    if (!chips.includes(v)) setChips((c) => [...c, v]);
    setChipInput("");
    setError(null);
  }

  function onChipKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === "," || e.key === " ") {
      e.preventDefault();
      commitChip();
    } else if (e.key === "Backspace" && !chipInput && chips.length) {
      setChips((c) => c.slice(0, -1));
    }
  }

  function collectViewers(): string[] {
    const viewers = visibility === "allowlist" ? [...chips] : [];
    if (
      visibility === "allowlist" &&
      chipInput.trim() &&
      EMAIL_RE.test(chipInput.trim().toLowerCase())
    ) {
      viewers.push(chipInput.trim().toLowerCase());
    }
    return viewers;
  }

  /** POST one file straight to S3 using a presigned policy, with progress. */
  function s3Post(
    url: string,
    fields: Record<string, string>,
    file: File,
    onProgress: (fraction: number) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const fd = new FormData();
      for (const [k, v] of Object.entries(fields)) fd.append(k, v);
      fd.append("file", file); // must be the last field in a POST policy
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(e.loaded / e.total);
      };
      xhr.onload = () =>
        xhr.status >= 200 && xhr.status < 300
          ? resolve()
          : reject(new Error(`Storage rejected the upload (${xhr.status})`));
      xhr.onerror = () => reject(new Error("network"));
      xhr.send(fd);
    });
  }

  /** Fallback: multipart through the app server (small uploads only). */
  async function publishViaServer(viewers: string[]) {
    const body = new FormData();
    for (const f of files) body.append("file", f);
    body.set("ttl", ttl);
    if (files.length > 1 && indexName) body.set("index", indexName);
    if (slug.trim()) body.set("slug", slug.trim());
    if (dest) body.set("workspaceId", dest);
    body.set("visibility", visibility);
    if (viewers.length) body.set("viewers", viewers.join(","));

    const res = await fetch("/api/upload", { method: "POST", body });
    const data = await res.json();
    if (!res.ok) setError(data.error || "Upload failed.");
    else {
      setPublished({ slug: data.slug, url: data.url, pages: data.pages });
      router.refresh();
    }
  }

  async function publish() {
    if (files.length === 0) {
      setError("Add at least one HTML file.");
      return;
    }
    if (files.length > 1 && !indexName) {
      setError("Pick which page is the index (entry page).");
      return;
    }
    setBusy(true);
    setError(null);
    setProgress(null);
    const viewers = collectViewers();
    const totalBytes = files.reduce((s, f) => s + f.size, 0);

    try {
      // Preferred path: presigned browser->S3 upload (no server body cap).
      const presignRes = await fetch("/api/upload/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          files: files.map((f) => ({ name: f.name, size: f.size })),
          ttl,
          workspaceId: dest || undefined,
          visibility,
        }),
      });
      const presign = await presignRes.json().catch(() => ({}));
      if (!presignRes.ok) {
        // Validation/gate errors are real answers — surface them. Only an
        // unavailable presign service falls back.
        if (presignRes.status === 503 && totalBytes <= FALLBACK_MAX) {
          await publishViaServer(viewers);
        } else {
          setError(presign.error || "Upload failed.");
        }
        return;
      }

      try {
        const done: number[] = files.map(() => 0);
        setProgress(0);
        for (let i = 0; i < files.length; i++) {
          const target = (presign.files as { name: string; url: string; fields: Record<string, string> }[])[i];
          await s3Post(target.url, target.fields, files[i], (frac) => {
            done[i] = frac * files[i].size;
            setProgress(
              Math.round((done.reduce((s, x) => s + x, 0) / totalBytes) * 100),
            );
          });
        }
      } catch (s3err) {
        // Storage unreachable (network/CORS) — retry small uploads via server.
        if (totalBytes <= FALLBACK_MAX) {
          setProgress(null);
          await publishViaServer(viewers);
          return;
        }
        throw s3err;
      }

      const completeRes = await fetch("/api/upload/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uploadId: presign.uploadId,
          ttl,
          slug: slug.trim() || undefined,
          index: files.length > 1 && indexName ? indexName : undefined,
          viewers: viewers.join(","),
          workspaceId: dest || undefined,
          visibility,
        }),
      });
      const data = await completeRes.json();
      if (!completeRes.ok) setError(data.error || "Upload failed.");
      else {
        setPublished({ slug: data.slug, url: data.url, pages: data.pages });
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error && err.message !== "network" ? err.message : "Network error during upload.");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  function reset() {
    setPublished(null);
    setFiles([]);
    setIndexName(null);
    setSlug("");
    setChips([]);
    setChipInput("");
    setTtl("7d");
    setDest("");
    setVisibility("allowlist");
    if (inputRef.current) inputRef.current.value = "";
  }

  const viewerLabel =
    visibility === "team"
      ? "Whole team"
      : visibility === "only_me" || chips.length === 0
        ? "Only me"
        : chips.length === 1
          ? "1 viewer"
          : `${chips.length} viewers`;
  const totalKb = files.reduce((s, f) => s + f.size, 0) / 1024;

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "34px 30px 100px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <Link href="/dashboard" className="btn btn-ghost" style={{ padding: "5px 9px", font: "600 12px/1 var(--font-ui)" }}>
          <ArrowLeft size={14} />
          Sites
        </Link>
      </div>
      <h1 style={{ margin: "0 0 26px", font: "800 26px/1 var(--font-ui)", letterSpacing: "-.02em", color: "var(--text)" }}>
        Publish a page
      </h1>

      {published ? (
        <PublishedCard published={published} ttl={ttl} viewerLabel={viewerLabel} onReset={reset} />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 20, alignItems: "start" }}>
          {/* left column */}
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                addFiles(e.dataTransfer.files);
              }}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 12,
                padding: files.length ? "22px 20px" : "44px 20px",
                borderRadius: "var(--r-lg)",
                border: `1.5px dashed ${dragging ? "var(--accent)" : "var(--border-strong)"}`,
                background: dragging ? "var(--accent-soft)" : "var(--surface-1)",
                cursor: "pointer",
                textAlign: "center",
                transition: "border-color .15s, background .15s, padding .15s",
              }}
            >
              <div style={{ width: 52, height: 52, borderRadius: 14, background: "var(--surface-3)", display: "grid", placeItems: "center", color: "var(--text-muted)" }}>
                <UploadCloud size={26} />
              </div>
              <div style={{ font: "700 15px/1.3 var(--font-ui)", color: "var(--text)" }}>
                {files.length ? "Add more pages" : "Drop your HTML files here"}
              </div>
              <div className="mb-mono" style={{ font: "500 12px/1.4 var(--font-mono)", color: "var(--text-subtle)" }}>
                self-contained .html · up to 25&nbsp;MB total · multi-page supported
              </div>
            </div>
            <input
              ref={inputRef}
              type="file"
              accept=".html,text/html"
              multiple
              style={{ display: "none" }}
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = "";
              }}
            />

            {files.length > 0 && (
              <div className="card" style={{ padding: "6px 16px" }}>
                {files.length > 1 && (
                  <div className="hint" style={{ margin: "10px 0 4px" }}>
                    <Home size={12} />
                    Pick the index — the page viewers land on at /{"{slug}"}
                  </div>
                )}
                {files.map((f) => (
                  <div
                    key={f.name}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "11px 0",
                      borderTop: "1px solid var(--border)",
                    }}
                  >
                    {files.length > 1 && (
                      <input
                        type="radio"
                        name="index"
                        checked={indexName === f.name}
                        onChange={() => setIndexName(f.name)}
                        style={{ accentColor: "var(--accent)", cursor: "pointer" }}
                        aria-label={`Make ${f.name} the index`}
                      />
                    )}
                    <FileCode2 size={17} style={{ color: "var(--success)", flex: "none" }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ font: "600 13px/1.2 var(--font-ui)", color: "var(--text)" }}>{f.name}</span>
                      {indexName === f.name && files.length > 1 && (
                        <span style={{ marginLeft: 8, padding: "2px 7px", borderRadius: 999, background: "var(--accent-soft)", border: "1px solid var(--accent-border)", color: "var(--text)", font: "600 10px/1 var(--font-ui)" }}>
                          index
                        </span>
                      )}
                    </div>
                    <span className="mb-mono" style={{ font: "500 11px/1 var(--font-mono)", color: "var(--text-subtle)" }}>
                      {(f.size / 1024).toFixed(1)} KB
                    </span>
                    <button onClick={() => removeFile(f.name)} aria-label="Remove" className="icon-btn" style={{ width: 28, height: 28 }}>
                      <X size={13} />
                    </button>
                  </div>
                ))}
                <div className="mb-mono" style={{ padding: "9px 0", borderTop: "1px solid var(--border)", font: "500 11px/1 var(--font-mono)", color: "var(--text-subtle)", textAlign: "right" }}>
                  {files.length} page{files.length > 1 ? "s" : ""} · {totalKb.toFixed(1)} KB total
                </div>
              </div>
            )}

            {/* config card */}
            <div className="card" style={{ padding: "22px 24px" }}>
              <div style={{ marginBottom: 18 }}>
                <label className="lbl">Site URL</label>
                <div className="focus-ring" style={{ display: "flex", alignItems: "stretch", borderRadius: "var(--r-md)", background: "var(--surface-2)", border: "1px solid var(--border-strong)", overflow: "hidden" }}>
                  <span
                    className="mb-mono"
                    style={{ display: "flex", alignItems: "center", padding: "0 12px", font: "500 13px/1 var(--font-mono)", color: "var(--text-subtle)", background: "color-mix(in srgb, var(--surface-3) 60%, transparent)", borderRight: "1px solid var(--border)" }}
                  >
                    {host}
                  </span>
                  <input
                    value={slug}
                    onChange={(e) => setSlug(e.target.value)}
                    placeholder="auto-generated if blank"
                    className="mb-mono"
                    style={{ flex: 1, minWidth: 0, padding: "11px 12px", border: "none", background: "transparent", color: "var(--text)", font: "500 13.5px/1 var(--font-mono)", outline: "none" }}
                  />
                </div>
                <div className="hint">
                  <Wand2 size={12} />
                  Human-readable slug · lowercase, numbers &amp; dashes
                </div>
              </div>

              <div style={{ marginBottom: 18 }}>
                <label className="lbl">Expires after</label>
                <div className="seg-group">
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
                {!allowedTtls.includes(ttl) && (
                  <div className="hint" style={{ color: "var(--warning)" }}>
                    <Clock size={12} />
                    Pick an available preset — current selection isn&apos;t allowed here.
                  </div>
                )}
              </div>

              {workspaces.length > 0 && (
                <div style={{ marginBottom: 18 }}>
                  <label className="lbl">Publish to</label>
                  <select
                    value={dest}
                    onChange={(e) => {
                      const next = e.target.value;
                      setDest(next);
                      const ws = workspaces.find((w) => w.id === next) || null;
                      if (visibility === "team" && (!ws || ws.plan !== "team")) {
                        setVisibility("allowlist");
                      }
                      const nextTtls = ws ? ws.allowedTtls : personalTtls;
                      if (!nextTtls.includes(ttl)) setTtl(nextTtls[nextTtls.length - 1]);
                    }}
                    className="field"
                  >
                    <option value="">Personal</option>
                    {workspaces.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div style={{ marginBottom: 18 }}>
                <label className="lbl">Who can view</label>
                <div className="seg-group">
                  <button className={`seg${visibility === "only_me" ? " active" : ""}`} onClick={() => setVisibility("only_me")}>
                    <Lock size={14} />
                    Only me
                  </button>
                  <button className={`seg${visibility === "allowlist" ? " active" : ""}`} onClick={() => setVisibility("allowlist")}>
                    <Mail size={14} />
                    Specific people
                  </button>
                  <button
                    className={`seg${visibility === "team" ? " active" : ""}`}
                    onClick={() => dest && !teamLocked && setVisibility("team")}
                    disabled={!dest || teamLocked}
                    style={!dest || teamLocked ? { opacity: 0.45, cursor: "not-allowed" } : undefined}
                    title={
                      !dest
                        ? "Pick a workspace destination first"
                        : teamLocked
                          ? "Team visibility requires the Team plan — upgrade from the workspace page"
                          : undefined
                    }
                  >
                    <Users size={14} />
                    Whole team
                  </button>
                </div>
              </div>

              {visibility === "allowlist" && (
              <div>
                <label className="lbl">Allowed viewers</label>
                <div className="focus-ring" style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", padding: 10, borderRadius: "var(--r-md)", background: "var(--surface-2)", border: "1px solid var(--border-strong)" }}>
                  {chips.map((chip, i) => (
                    <span key={chip} style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "5px 8px 5px 11px", borderRadius: 999, background: "var(--accent-soft)", border: "1px solid var(--accent-border)", color: "var(--text)", font: "500 12.5px/1 var(--font-ui)" }}>
                      <Mail size={12} style={{ color: "var(--accent)" }} />
                      {chip}
                      <button
                        onClick={() => setChips((c) => c.filter((_, j) => j !== i))}
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
                    onKeyDown={onChipKey}
                    onBlur={commitChip}
                    placeholder="name@company.com"
                    style={{ flex: 1, minWidth: 150, padding: "6px 4px", border: "none", background: "transparent", color: "var(--text)", font: "500 13.5px/1 var(--font-ui)", outline: "none" }}
                  />
                </div>
                <div className="hint">
                  <Shield size={12} />
                  You can edit this later from the site&apos;s manage panel. Enforced server-side.
                </div>
              </div>
              )}
            </div>
          </div>

          {/* summary panel */}
          <div className="card" style={{ position: "sticky", top: 88, padding: "22px 24px", boxShadow: "var(--shadow-1)" }}>
            <div style={{ font: "600 10.5px/1 var(--font-mono)", letterSpacing: ".12em", textTransform: "uppercase", color: "var(--text-subtle)", marginBottom: 16 }}>
              Before you publish
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 13, marginBottom: 20 }}>
              <SummaryRow icon={<Lock size={15} />} tint="accent" title="Private by default" sub="SSO required to view" />
              <SummaryRow icon={<Shield size={15} />} tint="success" title="Never publicly readable" sub="Access checked server-side" />
              <SummaryRow icon={<Timer size={15} />} tint="warning" title={`Self-destructs in ${TTL_LABEL[ttl]}`} sub="Restorable from trash for 7 days" />
            </div>
            <button onClick={publish} disabled={busy || files.length === 0} className="btn btn-primary" style={{ width: "100%", padding: "12px 16px", font: "700 14px/1 var(--font-ui)" }}>
              <Rocket size={16} />
              {busy
                ? progress !== null
                  ? `Uploading… ${progress}%`
                  : "Publishing…"
                : files.length > 1
                  ? `Publish ${files.length}-page site`
                  : "Publish private site"}
            </button>
            {progress !== null && (
              <div style={{ marginTop: 10, height: 6, borderRadius: 999, background: "var(--surface-2)", border: "1px solid var(--border)", overflow: "hidden" }}>
                <div style={{ width: `${progress}%`, height: "100%", background: "var(--accent)", transition: "width .2s" }} />
              </div>
            )}
            {error && (
              <div style={{ marginTop: 12, padding: "9px 11px", borderRadius: "var(--r-md)", background: "var(--danger-soft)", border: "1px solid var(--danger-border)", color: "var(--text)", font: "500 12px/1.4 var(--font-ui)" }}>
                {error}
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 12, font: "500 10.5px/1.3 var(--font-mono)", color: "var(--text-subtle)" }}>
              <Users size={11} />
              Shared only with people you allowlist
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryRow({
  icon,
  tint,
  title,
  sub,
}: {
  icon: React.ReactNode;
  tint: "accent" | "success" | "warning";
  title: string;
  sub: string;
}) {
  const color = `var(--${tint})`;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
      <div style={{ width: 32, height: 32, borderRadius: 9, background: `var(--${tint}-soft)`, display: "grid", placeItems: "center", color, flex: "none" }}>
        {icon}
      </div>
      <div>
        <div style={{ font: "600 12.5px/1.2 var(--font-ui)", color: "var(--text)" }}>{title}</div>
        <div style={{ font: "400 11.5px/1.3 var(--font-ui)", color: "var(--text-muted)", marginTop: 2 }}>{sub}</div>
      </div>
    </div>
  );
}

function PublishedCard({
  published,
  ttl,
  viewerLabel,
  onReset,
}: {
  published: { slug: string; url: string; pages: number };
  ttl: string;
  viewerLabel: string;
  onReset: () => void;
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(published.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }
  return (
    <div className="card" style={{ maxWidth: 560, margin: "0 auto", textAlign: "center", padding: "38px 34px", boxShadow: "var(--shadow-2)" }}>
      <div style={{ width: 58, height: 58, margin: "0 auto 18px", borderRadius: 15, background: "var(--success-soft)", border: "1px solid var(--success-border)", display: "grid", placeItems: "center", color: "var(--success)" }}>
        <Check size={30} />
      </div>
      <h2 style={{ margin: "0 0 8px", font: "800 21px/1.15 var(--font-ui)", letterSpacing: "-.02em", color: "var(--text)" }}>
        Your site is live &amp; private
      </h2>
      <p style={{ margin: "0 0 22px", font: "400 13.5px/1.5 var(--font-ui)", color: "var(--text-muted)" }}>
        {published.pages > 1
          ? `${published.pages} pages published. Only allowlisted viewers can open them after signing in.`
          : "Only allowlisted viewers can open it after signing in."}
      </p>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "11px 12px", borderRadius: "var(--r-md)", background: "var(--surface-2)", border: "1px solid var(--border-strong)", marginBottom: 16 }}>
        <Link2 size={14} style={{ color: "var(--accent)", flex: "none" }} />
        <span className="mb-mono" style={{ flex: 1, textAlign: "left", font: "500 13px/1 var(--font-mono)", color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {published.url}
        </span>
        <button onClick={copy} className="btn btn-primary" style={{ padding: "7px 12px", font: "600 12px/1 var(--font-ui)", flex: "none" }}>
          <Copy size={13} />
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 7, justifyContent: "center", marginBottom: 24 }}>
        <Pill icon={<Lock size={11} style={{ color: "var(--accent)" }} />} bg="var(--accent-soft)" bd="var(--accent-border)" text="Private" />
        <Pill icon={<Users size={11} />} bg="var(--surface-3)" bd="var(--border-strong)" text={viewerLabel} muted />
        <Pill icon={<Timer size={11} style={{ color: "var(--warning)" }} />} bg="var(--warning-soft)" bd="var(--warning-border)" text={TTL_LABEL[ttl] || ttl} />
        {published.pages > 1 && (
          <Pill icon={<FileCode2 size={11} />} bg="var(--surface-3)" bd="var(--border-strong)" text={`${published.pages} pages`} muted />
        )}
      </div>
      <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
        <button onClick={onReset} className="btn btn-neutral">
          <UploadCloud size={14} />
          Upload another
        </button>
        <Link href="/dashboard" className="btn btn-primary">
          Go to dashboard
        </Link>
      </div>
    </div>
  );
}

function Pill({
  icon,
  bg,
  bd,
  text,
  muted,
}: {
  icon: React.ReactNode;
  bg: string;
  bd: string;
  text: string;
  muted?: boolean;
}) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 11px", borderRadius: 999, background: bg, border: `1px solid ${bd}`, color: muted ? "var(--text-muted)" : "var(--text)", font: "600 11px/1 var(--font-ui)", whiteSpace: "nowrap" }}>
      {icon}
      {text}
    </span>
  );
}
