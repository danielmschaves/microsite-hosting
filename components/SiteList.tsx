"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface SiteView {
  id: string;
  slug: string;
  url: string;
  sizeBytes: number;
  ttlPreset: string;
  expiresAt: string;
}

function countdown(expiresAt: string): { label: string; cls: string } {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return { label: "expired", cls: "badge expired" };
  const hours = ms / 3_600_000;
  if (hours < 24) {
    return { label: `expires in ${Math.max(1, Math.round(hours))}h`, cls: "badge warn" };
  }
  const days = Math.round(hours / 24);
  return { label: `expires in ${days}d`, cls: "badge" };
}

export function SiteList({ sites }: { sites: SiteView[] }) {
  const router = useRouter();
  const [copied, setCopied] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  async function copy(site: SiteView) {
    try {
      await navigator.clipboard.writeText(site.url);
      setCopied(site.id);
      setTimeout(() => setCopied((c) => (c === site.id ? null : c)), 1500);
    } catch {
      // clipboard may be unavailable over http; ignore
    }
  }

  async function remove(site: SiteView) {
    if (!confirm(`Delete "${site.slug}"? This removes the hosted page.`)) return;
    setDeleting(site.id);
    try {
      const res = await fetch(`/api/sites/${site.id}`, { method: "DELETE" });
      if (res.ok) router.refresh();
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div>
      {sites.map((site) => {
        const c = countdown(site.expiresAt);
        return (
          <div className="site" key={site.id}>
            <div className="meta">
              <div className="slug">
                <a href={site.url} target="_blank" rel="noreferrer">
                  {site.slug}
                </a>
              </div>
              <div className="sub">
                <span className={c.cls}>{c.label}</span>{" "}
                <span>{(site.sizeBytes / 1024).toFixed(1)} KB</span>
              </div>
            </div>
            <div className="actions">
              <button className="btn secondary" onClick={() => copy(site)}>
                {copied === site.id ? "Copied!" : "Copy link"}
              </button>
              <button
                className="btn danger"
                onClick={() => remove(site)}
                disabled={deleting === site.id}
              >
                {deleting === site.id ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
