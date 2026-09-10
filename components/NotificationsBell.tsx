"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, BellRing, Timer, TimerReset, CheckCircle2 } from "lucide-react";

interface NotifItem {
  id: string;
  slug: string;
  expiresAt: string;
}

interface ApprovalNotifItem {
  id: string;
  slug: string;
  action: string;
  workspaceId: string;
  expiresAt: string;
}

function leftLabel(iso: string): { label: string; urgent: boolean } {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return { label: "now", urgent: true };
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return { label: h >= 1 ? `${h}h ${m}m` : `${m}m`, urgent: h < 2 };
}

export function NotificationsBell() {
  const router = useRouter();
  const [items, setItems] = useState<NotifItem[]>([]);
  const [approvals, setApprovals] = useState<ApprovalNotifItem[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  async function load() {
    try {
      const res = await fetch("/api/notifications");
      if (!res.ok) return;
      const data = await res.json();
      setItems(Array.isArray(data.items) ? data.items : []);
      setApprovals(Array.isArray(data.pendingApprovals) ? data.pendingApprovals : []);
    } catch {
      /* bell is best-effort */
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 5 * 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (open && wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  async function extend(id: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/sites/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ttl: "7d" }),
      });
      if (res.ok) {
        setItems((xs) => xs.filter((x) => x.id !== id));
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Notifications"
        className="icon-btn"
        style={{ position: "relative", width: 32, height: 32, borderRadius: 8 }}
      >
        <Bell size={15} />
        {items.length + approvals.length > 0 && (
          <span
            style={{
              position: "absolute",
              top: 5,
              right: 6,
              width: 8,
              height: 8,
              borderRadius: 999,
              background: "var(--warning)",
              border: "2px solid var(--surface-1)",
              animation: "mb-pulse 2s infinite",
            }}
          />
        )}
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: 42,
            right: 0,
            zIndex: 70,
            width: 344,
            borderRadius: "var(--r-lg)",
            border: "1px solid var(--border-strong)",
            background: "var(--surface-1)",
            boxShadow: "var(--shadow-3)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "13px 16px",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <span style={{ font: "700 13px/1 var(--font-ui)", color: "var(--text)" }}>
              Expiring soon
            </span>
            <span
              className="mb-mono"
              style={{
                font: "600 10.5px/1 var(--font-mono)",
                letterSpacing: ".08em",
                textTransform: "uppercase",
                color: "var(--text-subtle)",
              }}
            >
              {items.length} alert{items.length === 1 ? "" : "s"}
            </span>
          </div>

          {items.length === 0 ? (
            <div
              style={{
                padding: "26px 16px",
                textAlign: "center",
                font: "400 12.5px/1.5 var(--font-ui)",
                color: "var(--text-muted)",
              }}
            >
              Nothing expiring in the next 48 hours.
            </div>
          ) : (
            items.map((n) => {
              const { label, urgent } = leftLabel(n.expiresAt);
              return (
                <div
                  key={n.id}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 11,
                    padding: "14px 16px",
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  {urgent ? (
                    <BellRing size={16} style={{ color: "var(--danger)", flex: "none" }} />
                  ) : (
                    <Timer size={16} style={{ color: "var(--warning)", flex: "none" }} />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <a
                      href={`/sites/${n.id}`}
                      style={{
                        display: "block",
                        font: "600 12.5px/1.3 var(--font-ui)",
                        color: "var(--text)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {n.slug}
                    </a>
                    <div
                      className="mb-mono"
                      style={{
                        font: "500 11px/1.3 var(--font-mono)",
                        marginTop: 4,
                        color: urgent ? "var(--danger)" : "var(--warning)",
                      }}
                    >
                      expires in {label}
                    </div>
                  </div>
                  <button
                    onClick={() => extend(n.id)}
                    disabled={busy !== null}
                    style={{
                      flex: "none",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      padding: "6px 10px",
                      borderRadius: 8,
                      font: "600 11.5px/1 var(--font-ui)",
                      cursor: "pointer",
                      background: "var(--accent-soft)",
                      border: "1px solid var(--accent-border)",
                      color: "var(--text)",
                    }}
                  >
                    <TimerReset size={12} />
                    {busy === n.id ? "…" : "+7d"}
                  </button>
                </div>
              );
            })
          )}

          {approvals.length > 0 && (
            <>
              <div
                style={{
                  padding: "9px 16px",
                  borderTop: "1px solid var(--border)",
                  font: "700 10.5px/1 var(--font-mono)",
                  letterSpacing: ".06em",
                  textTransform: "uppercase",
                  color: "var(--text-subtle)",
                }}
              >
                Pending approvals
              </div>
              {approvals.map((a) => (
                <a
                  key={a.id}
                  href={`/teams/${a.workspaceId}/approvals`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 11,
                    padding: "12px 16px",
                    borderTop: "1px solid var(--border)",
                  }}
                >
                  <CheckCircle2 size={16} style={{ color: "var(--accent)", flex: "none" }} />
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      font: "600 12.5px/1.3 var(--font-ui)",
                      color: "var(--text)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {a.action} &ldquo;{a.slug}&rdquo;
                  </span>
                </a>
              ))}
            </>
          )}

          <div
            style={{
              padding: "11px 16px",
              background: "var(--surface-2)",
              font: "500 10.5px/1.4 var(--font-mono)",
              color: "var(--text-subtle)",
            }}
          >
            Alerts sent at T-48h and T-2h · email + in-app
          </div>
        </div>
      )}
    </div>
  );
}
