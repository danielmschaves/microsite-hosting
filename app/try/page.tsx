"use client";

import { useState } from "react";
import Link from "next/link";
import { UploadCloud, ShieldCheck, ExternalLink, LogIn } from "lucide-react";
import { Banner } from "@/components/ui";
import { ThemeToggle } from "@/components/ThemeToggle";

interface PublishResult {
  slug: string;
  url: string;
  expiresAt: string;
}

// Anonymous, no-signup trial publish (CD-18). Deliberately outside the
// authenticated app shell (no AppBar) — this page exists so a visitor with
// zero MicroBuild account can go from "I have an HTML file" to a link in one
// click, then decide whether to sign in and keep it.
export default function TryPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PublishResult | null>(null);

  async function onFile(file: File) {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/guest/publish", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.message || data.error || "Could not publish that file.");
        return;
      }
      setResult({ slug: data.slug, url: data.url, expiresAt: data.expiresAt });
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "40px 22px",
        background: "radial-gradient(130% 90% at 50% -10%, var(--accent-soft), transparent 55%)",
      }}
    >
      <div style={{ position: "fixed", top: 18, right: 22 }}>
        <ThemeToggle />
      </div>

      <div style={{ width: "100%", maxWidth: 460 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 26 }}>
          <ShieldCheck size={18} style={{ color: "var(--accent)" }} />
          <span style={{ font: "800 16px/1 var(--font-ui)", letterSpacing: "-.02em", color: "var(--text)" }}>
            MicroBuild — try it free
          </span>
        </div>

        <div className="card" style={{ borderColor: "var(--border-strong)", padding: "32px 30px", boxShadow: "var(--shadow-3)" }}>
          <h1 style={{ margin: "0 0 8px", font: "800 21px/1.2 var(--font-ui)", color: "var(--text)" }}>
            Drop an HTML file, get a link
          </h1>
          <p style={{ margin: "0 0 20px", font: "400 13px/1.5 var(--font-ui)", color: "var(--text-muted)" }}>
            No account needed. One file, up to 5MB, live for 24 hours, publicly linkable but not
            search-indexed.
          </p>

          {!result && (
            <label
              className="field"
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 8,
                padding: "26px 16px",
                cursor: busy ? "wait" : "pointer",
                textAlign: "center",
              }}
            >
              <UploadCloud size={22} style={{ color: "var(--accent)" }} />
              <span style={{ font: "600 13px/1.3 var(--font-ui)", color: "var(--text)" }}>
                {busy ? "Publishing…" : "Choose an .html file"}
              </span>
              <input
                type="file"
                accept=".html,.htm,text/html"
                style={{ display: "none" }}
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onFile(file);
                  e.target.value = "";
                }}
              />
            </label>
          )}

          {error && (
            <div style={{ marginTop: 14 }}>
              <Banner tone="danger">{error}</Banner>
            </div>
          )}

          {result && (
            <div style={{ marginTop: 4 }}>
              <Banner tone="success">Published — live for 24 hours.</Banner>
              <a
                href={result.url}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginTop: 14,
                  padding: "12px 14px",
                  borderRadius: "var(--r-md)",
                  background: "var(--surface-2)",
                  border: "1px solid var(--border-strong)",
                  font: "600 13px/1 var(--font-mono)",
                  color: "var(--text)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                <ExternalLink size={14} style={{ flex: "none" }} />
                {result.url}
              </a>
              <div
                style={{
                  marginTop: 18,
                  padding: "14px 16px",
                  borderRadius: "var(--r-md)",
                  background: "var(--accent-soft)",
                  border: "1px solid var(--accent-border)",
                }}
              >
                <div style={{ font: "600 13px/1.4 var(--font-ui)", color: "var(--text)", marginBottom: 10 }}>
                  Sign in to keep this site — trial links expire in 24 hours.
                </div>
                <Link href={`/?callbackUrl=${encodeURIComponent("/claim")}`} className="btn btn-primary">
                  <LogIn size={15} />
                  Sign in to claim it
                </Link>
              </div>
              <button
                onClick={() => setResult(null)}
                className="btn btn-ghost"
                style={{ marginTop: 12, width: "100%", justifyContent: "center" }}
              >
                Publish another
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
