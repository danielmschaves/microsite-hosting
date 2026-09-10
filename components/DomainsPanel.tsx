"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, CheckCircle2, RefreshCw, Star, Clock, XCircle } from "lucide-react";
import { Banner, Pill } from "@/components/ui";
import type { DomainStatus, DnsRecord } from "@/lib/db";

export interface DomainItem {
  id: string;
  hostname: string;
  dnsRecords: DnsRecord[];
  status: DomainStatus;
  certStatus: string;
  isPrimary: boolean;
}

const STATUS_TONE: Record<DomainStatus, "warning" | "success" | "danger"> = {
  pending: "warning",
  verified: "success",
  failed: "danger",
};

// CD-21: add/verify/remove custom domains, DNS records shown as copyable
// rows. Certificate issuance (CD-22) isn't wired up yet — certStatus is
// shown as-is (today it's always "none") rather than hidden, so the UI
// doesn't silently lie once a later release starts writing real values.
export function DomainsPanel({ siteId, domains }: { siteId: string; domains: DomainItem[] }) {
  const router = useRouter();
  const [hostname, setHostname] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function call(key: string, fn: () => Promise<Response>) {
    setBusy(key);
    setError(null);
    try {
      const res = await fn();
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || data.message || "Request failed.");
        return null;
      }
      router.refresh();
      return data;
    } catch {
      setError("Network error.");
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function addDomain() {
    const value = hostname.trim();
    if (!value) return;
    const result = await call("add", () =>
      fetch(`/api/sites/${siteId}/domains`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hostname: value }),
      }),
    );
    if (result) setHostname("");
  }

  const verify = (id: string) =>
    call(`verify-${id}`, () =>
      fetch(`/api/sites/${siteId}/domains/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "verify" }),
      }),
    );

  const setPrimary = (id: string) =>
    call(`primary-${id}`, () =>
      fetch(`/api/sites/${siteId}/domains/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_primary" }),
      }),
    );

  const remove = (id: string, host: string) => {
    if (!confirm(`Remove "${host}"? DNS records you created will stop working.`)) return;
    return call(`remove-${id}`, () =>
      fetch(`/api/sites/${siteId}/domains/${id}`, { method: "DELETE" }),
    );
  };

  async function copy(value: string, key: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* ignore */
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="card" style={{ padding: 20 }}>
        <div style={{ font: "700 14px/1 var(--font-ui)", color: "var(--text)", marginBottom: 6 }}>
          Add a domain
        </div>
        <div style={{ font: "400 12.5px/1.5 var(--font-ui)", color: "var(--text-muted)", marginBottom: 14 }}>
          Up to 5 per site. You&apos;ll get DNS records to create, then verify once they propagate.
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input
            value={hostname}
            onChange={(e) => setHostname(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addDomain()}
            placeholder="reports.acme.com"
            className="field mb-mono"
            style={{ flex: 1, minWidth: 200 }}
          />
          <button onClick={addDomain} disabled={busy !== null || !hostname.trim()} className="btn btn-primary">
            <Plus size={15} />
            {busy === "add" ? "Adding…" : "Add domain"}
          </button>
        </div>
      </div>

      {error && <Banner tone="danger">{error}</Banner>}

      {domains.length === 0 ? (
        <div className="card" style={{ padding: 20, font: "400 13px/1.5 var(--font-ui)", color: "var(--text-muted)" }}>
          No custom domains yet — this site is reachable at its default URL only.
        </div>
      ) : (
        domains.map((d) => (
          <div key={d.id} className="card" style={{ padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
              <span className="mb-mono" style={{ font: "700 14px/1 var(--font-mono)", color: "var(--text)" }}>
                {d.hostname}
              </span>
              {d.isPrimary && (
                <Pill tone="accent">
                  <Star size={11} />
                  Primary
                </Pill>
              )}
              <Pill tone={STATUS_TONE[d.status]}>
                {d.status === "verified" ? <CheckCircle2 size={11} /> : d.status === "failed" ? <XCircle size={11} /> : <Clock size={11} />}
                {d.status}
              </Pill>
              <span
                className="mb-mono"
                style={{ font: "500 10.5px/1 var(--font-mono)", color: "var(--text-subtle)" }}
              >
                cert: {d.certStatus}
              </span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
              {d.dnsRecords.map((r, i) => (
                <div
                  key={i}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "80px 1fr auto",
                    gap: 10,
                    alignItems: "center",
                    padding: "9px 11px",
                    borderRadius: "var(--r-md)",
                    background: "var(--surface-2)",
                    border: "1px solid var(--border)",
                  }}
                >
                  <Pill mono>{r.type}</Pill>
                  <div className="mb-mono" style={{ font: "500 12px/1.5 var(--font-mono)", color: "var(--text)", overflowWrap: "anywhere" }}>
                    <div style={{ color: "var(--text-subtle)" }}>{r.name}</div>
                    <div>{r.value}</div>
                    {r.note && (
                      <div style={{ font: "400 11px/1.4 var(--font-ui)", color: "var(--text-muted)", marginTop: 3 }}>
                        {r.note}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => copy(r.value, `${d.id}-${i}`)}
                    className="btn btn-ghost"
                    style={{ padding: "5px 9px", font: "600 11px/1 var(--font-ui)" }}
                  >
                    {copied === `${d.id}-${i}` ? "Copied" : "Copy"}
                  </button>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {d.status !== "verified" && (
                <button onClick={() => verify(d.id)} disabled={busy !== null} className="btn btn-neutral">
                  <RefreshCw size={13} />
                  {busy === `verify-${d.id}` ? "Checking…" : "Verify"}
                </button>
              )}
              {d.status === "verified" && !d.isPrimary && (
                <button onClick={() => setPrimary(d.id)} disabled={busy !== null} className="btn btn-neutral">
                  <Star size={13} />
                  {busy === `primary-${d.id}` ? "Setting…" : "Set as primary"}
                </button>
              )}
              <button
                onClick={() => remove(d.id, d.hostname)}
                disabled={busy !== null}
                className="btn btn-ghost"
                style={{ border: "1px solid var(--border-strong)", color: "var(--danger)" }}
              >
                <Trash2 size={13} />
                Remove
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
