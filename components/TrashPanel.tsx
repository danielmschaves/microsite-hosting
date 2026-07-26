"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ClockAlert, Eraser, RotateCcw, Trash2 } from "lucide-react";
import { Banner } from "@/components/ui";
import type { TrashItem, WorkspaceTrash } from "@/lib/trash";

function sizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function purgeLabel(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "next sweep";
  const days = Math.ceil(ms / (24 * 3600 * 1000));
  return days === 1 ? "1d" : `${days}d`;
}

export function TrashPanel({
  personal,
  workspaces,
}: {
  personal: TrashItem[];
  workspaces: WorkspaceTrash[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function call(key: string, fn: () => Promise<Response>) {
    setBusy(key);
    setError(null);
    try {
      const res = await fn();
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Request failed.");
        return;
      }
      router.refresh();
    } catch {
      setError("Network error.");
    } finally {
      setBusy(null);
    }
  }

  const restore = (id: string) =>
    call(`restore-${id}`, () =>
      fetch(`/api/sites/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore" }),
      }),
    );

  async function purge(item: TrashItem) {
    if (!confirm(`Permanently delete "${item.slug}"? This cannot be undone.`)) return;
    await call(`purge-${item.id}`, () =>
      fetch(`/api/sites/${item.id}?permanent=true`, { method: "DELETE" }),
    );
  }

  const empty = personal.length === 0 && workspaces.length === 0;

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "30px 30px 100px" }}>
      <h1
        style={{
          margin: "0 0 6px",
          font: "800 26px/1 var(--font-ui)",
          letterSpacing: "-.02em",
          color: "var(--text)",
        }}
      >
        Trash
      </h1>
      <p style={{ margin: "0 0 22px", font: "400 13.5px/1 var(--font-ui)", color: "var(--text-muted)" }}>
        Expired and deleted sites stay recoverable for 7 days, then vanish from storage.
      </p>

      {!empty && (
        <div style={{ marginBottom: 20 }}>
          <Banner
            tone="warning"
            icon={<ClockAlert size={17} style={{ color: "var(--warning)", flex: "none" }} />}
          >
            Links are already revoked. Restoring re-publishes at the same URL with a
            fresh TTL.
          </Banner>
        </div>
      )}

      {error && (
        <div style={{ marginBottom: 16 }}>
          <Banner tone="danger">{error}</Banner>
        </div>
      )}

      {empty ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
            padding: "56px 24px",
            border: "1.5px dashed var(--border-strong)",
            borderRadius: "var(--r-lg)",
            background: "var(--surface-1)",
          }}
        >
          <div
            style={{
              width: 60,
              height: 60,
              borderRadius: 16,
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              display: "grid",
              placeItems: "center",
              color: "var(--text-subtle)",
              marginBottom: 18,
            }}
          >
            <Trash2 size={28} />
          </div>
          <h2 style={{ margin: "0 0 8px", font: "800 19px/1.2 var(--font-ui)", color: "var(--text)" }}>
            Trash is empty
          </h2>
          <p
            style={{
              margin: 0,
              font: "400 13px/1.5 var(--font-ui)",
              color: "var(--text-muted)",
              maxWidth: "40ch",
            }}
          >
            Nothing waiting to be purged — every site either expired cleanly or is
            still live.
          </p>
        </div>
      ) : (
        <>
          {personal.length > 0 && (
            <TrashList
              items={personal}
              busy={busy}
              onRestore={restore}
              onPurge={purge}
              canRestore
            />
          )}
          {workspaces.map((ws) => (
            <div key={ws.workspaceId} style={{ marginTop: 26 }}>
              <div
                style={{
                  font: "700 13px/1 var(--font-ui)",
                  color: "var(--text)",
                  marginBottom: 10,
                }}
              >
                {ws.workspaceName}
                <span
                  className="mb-mono"
                  style={{
                    font: "500 10.5px/1 var(--font-mono)",
                    color: "var(--text-subtle)",
                    marginLeft: 8,
                  }}
                >
                  WORKSPACE · ADMIN VIEW
                </span>
              </div>
              <TrashList
                items={ws.items}
                busy={busy}
                onRestore={restore}
                onPurge={purge}
                canRestore={false}
                showOwner
              />
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function TrashList({
  items,
  busy,
  onRestore,
  onPurge,
  canRestore,
  showOwner = false,
}: {
  items: TrashItem[];
  busy: string | null;
  onRestore: (id: string) => void;
  onPurge: (item: TrashItem) => void;
  canRestore: boolean;
  showOwner?: boolean;
}) {
  return (
    <div className="card" style={{ overflow: "hidden" }}>
      {items.map((t, i) => (
        <div
          key={t.id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "14px 18px",
            borderTop: i === 0 ? "none" : "1px solid var(--border)",
          }}
        >
          <div
            style={{
              width: 44,
              height: 34,
              borderRadius: 8,
              flex: "none",
              backgroundImage:
                "repeating-linear-gradient(135deg, var(--surface-3) 0 6px, var(--surface-2) 6px 12px)",
              border: "1px solid var(--border)",
              opacity: 0.5,
            }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                font: "700 13.5px/1.2 var(--font-ui)",
                color: "var(--text)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {t.slug}
            </div>
            <div
              className="mb-mono"
              style={{
                font: "500 11px/1 var(--font-mono)",
                color: "var(--text-subtle)",
                marginTop: 5,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {t.reason} · {sizeLabel(t.sizeBytes)}
              {showOwner ? ` · ${t.owner}` : ""}
            </div>
          </div>
          <span className="pill pill-danger" style={{ flex: "none" }}>
            <Eraser size={11} style={{ color: "var(--danger)" }} />
            <span className="mb-mono" style={{ color: "var(--danger)" }}>
              purges in {purgeLabel(t.purgeAt)}
            </span>
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 7, flex: "none" }}>
            {canRestore && (
              <button
                onClick={() => onRestore(t.id)}
                disabled={busy !== null}
                className="btn btn-neutral"
                style={{ padding: "8px 12px", font: "600 12px/1 var(--font-ui)" }}
              >
                <RotateCcw size={13} />
                {busy === `restore-${t.id}` ? "Restoring…" : "Restore"}
              </button>
            )}
            <button
              onClick={() => onPurge(t)}
              disabled={busy !== null}
              aria-label="Delete forever"
              className="icon-btn danger"
              style={{ width: 32, height: 32 }}
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
