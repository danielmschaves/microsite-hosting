"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BillingCard, type BillingInfo } from "@/components/BillingCard";
import {
  ArrowLeft,
  Users,
  Mail,
  Crown,
  Shield,
  X,
  Plus,
  Copy,
  Clock,
  Check,
  LogOut,
  Pencil,
  HardDrive,
  Globe,
  Lock,
  TimerOff,
  Trash2,
  ScrollText,
} from "lucide-react";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const TTL_LABEL: Record<string, string> = {
  "24h": "24 hours",
  "7d": "7 days",
  "30d": "30 days",
};

export interface TeamMember {
  email: string;
  role: string;
  joinedAt: string;
}
export interface TeamInvite {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
}
export interface TeamSite {
  id: string;
  slug: string;
  owner: string;
  sizeBytes: number;
  visibility: string;
  expiresAt: string;
}
export interface AuditEntry {
  type: string;
  actor: string | null;
  slug: string | null;
  meta: Record<string, unknown>;
  at: string;
}

export function TeamPanel({
  workspace,
  myRole,
  myEmail,
  members,
  invites,
  sites = [],
  audit = [],
  billing,
}: {
  workspace: { id: string; name: string; plan: string; maxTtl: string | null };
  myRole: string;
  myEmail: string;
  members: TeamMember[];
  invites: TeamInvite[];
  sites?: TeamSite[];
  audit?: AuditEntry[];
  billing?: BillingInfo;
}) {
  const router = useRouter();
  const isAdmin = myRole === "admin" || myRole === "owner";
  const isOwner = myRole === "owner";

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [inviteInput, setInviteInput] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "admin">("member");
  const [lastInviteUrl, setLastInviteUrl] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState(workspace.name);
  const [maxTtl, setMaxTtl] = useState<string | null>(workspace.maxTtl);
  const [copiedInvite, setCopiedInvite] = useState(false);

  function flash(msg: string) {
    setNotice(msg);
    setError(null);
    setTimeout(() => setNotice(null), 2500);
  }

  async function call(
    key: string,
    fn: () => Promise<Response>,
    okMsg?: string,
  ): Promise<Record<string, unknown> | null> {
    setBusy(key);
    setError(null);
    try {
      const res = await fn();
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data as { error?: string }).error || "Request failed.");
        return null;
      }
      if (okMsg) flash(okMsg);
      router.refresh();
      return data as Record<string, unknown>;
    } catch {
      setError("Network error.");
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function invite() {
    const email = inviteInput.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      setError("Enter a valid email address.");
      return;
    }
    const data = await call(
      "invite",
      () =>
        fetch(`/api/workspaces/${workspace.id}/invites`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, role: inviteRole }),
        }),
    );
    if (data) {
      setInviteInput("");
      setLastInviteUrl(String(data.inviteUrl));
      flash(
        data.emailSent
          ? `Invite emailed to ${email}.`
          : `Invite created — share the link below with ${email}.`,
      );
    }
  }

  async function copyInviteUrl() {
    if (!lastInviteUrl) return;
    try {
      await navigator.clipboard.writeText(lastInviteUrl);
      setCopiedInvite(true);
      setTimeout(() => setCopiedInvite(false), 1500);
    } catch {
      /* ignore */
    }
  }

  const revokeInvite = (inviteId: string) =>
    call(
      `revoke-${inviteId}`,
      () =>
        fetch(`/api/workspaces/${workspace.id}/invites`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ inviteId }),
        }),
      "Invite revoked.",
    );

  const setRole = (email: string, role: string) =>
    call(
      `role-${email}`,
      () =>
        fetch(`/api/workspaces/${workspace.id}/members`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, role }),
        }),
      "Role updated.",
    );

  const removeMember = (email: string) =>
    call(
      `remove-${email}`,
      () =>
        fetch(`/api/workspaces/${workspace.id}/members`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        }),
      "Member removed.",
    );

  async function leave() {
    if (!confirm(`Leave "${workspace.name}"?`)) return;
    const data = await call("leave", () =>
      fetch(`/api/workspaces/${workspace.id}/members`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: myEmail }),
      }),
    );
    if (data) router.push("/teams");
  }

  const rename = () =>
    call(
      "rename",
      () =>
        fetch(`/api/workspaces/${workspace.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: nameDraft }),
        }),
      "Workspace renamed.",
    );

  const saveMaxTtl = (value: string | null) => {
    setMaxTtl(value);
    call(
      "maxttl",
      () =>
        fetch(`/api/workspaces/${workspace.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ maxTtl: value }),
        }),
      "TTL policy saved.",
    );
  };

  const roleBadge = (role: string) => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 999, background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text-muted)", font: "600 10.5px/1 var(--font-ui)", textTransform: "capitalize", whiteSpace: "nowrap" }}>
      {role === "owner" ? <Crown size={11} /> : role === "admin" ? <Shield size={11} /> : null}
      {role}
    </span>
  );

  return (
    <div style={{ maxWidth: 780, margin: "0 auto", padding: "34px 30px 100px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <Link href="/teams" className="btn btn-ghost" style={{ padding: "5px 9px", font: "600 12px/1 var(--font-ui)" }}>
          <ArrowLeft size={14} />
          Teams
        </Link>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
        <h1 style={{ margin: 0, font: "800 26px/1 var(--font-ui)", letterSpacing: "-.02em", color: "var(--text)" }}>
          {workspace.name}
        </h1>
        <span style={{ padding: "4px 11px", borderRadius: 999, background: workspace.plan === "team" ? "var(--accent-soft)" : "var(--surface-2)", border: `1px solid ${workspace.plan === "team" ? "var(--accent-border)" : "var(--border)"}`, color: workspace.plan === "team" ? "var(--text)" : "var(--text-muted)", font: "600 11px/1 var(--font-ui)" }}>
          {workspace.plan === "team" ? "Team plan" : "Free"}
        </span>
      </div>
      <p style={{ margin: "0 0 22px", font: "400 13px/1 var(--font-ui)", color: "var(--text-muted)" }}>
        {members.length} member{members.length === 1 ? "" : "s"} · your role: {myRole}
      </p>

      {(notice || error) && (
        <div style={{ marginBottom: 16, padding: "10px 13px", borderRadius: "var(--r-md)", background: error ? "var(--danger-soft)" : "var(--success-soft)", border: `1px solid ${error ? "var(--danger-border)" : "var(--success-border)"}`, color: "var(--text)", font: "500 12.5px/1.4 var(--font-ui)" }}>
          {error || notice}
        </div>
      )}

      {/* usage */}
      <div className="card" style={{ padding: 24, marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, font: "700 15px/1 var(--font-ui)", color: "var(--text)", marginBottom: 14 }}>
          <HardDrive size={15} />
          Usage
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 }}>
          <UsageStat label="Active sites" value={String(sites.length)} />
          <UsageStat label="Storage" value={sizeLabel(sites.reduce((s, x) => s + x.sizeBytes, 0))} />
          <UsageStat label="Members" value={String(members.length)} />
        </div>
      </div>

      {/* members */}
      <div className="card" style={{ padding: 24, marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, font: "700 15px/1 var(--font-ui)", color: "var(--text)", marginBottom: 14 }}>
          <Users size={15} />
          Members
        </div>
        {members.map((m, i) => (
          <div key={m.email} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderTop: i === 0 ? "none" : "1px solid var(--border)" }}>
            <Mail size={14} style={{ color: "var(--text-subtle)", flex: "none" }} />
            <span style={{ flex: 1, font: "500 13.5px/1.2 var(--font-ui)", color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {m.email}
              {m.email === myEmail && (
                <span style={{ color: "var(--text-subtle)", font: "500 11px/1 var(--font-mono)" }}> (you)</span>
              )}
            </span>
            {isOwner && m.role !== "owner" ? (
              <select
                value={m.role}
                onChange={(e) => setRole(m.email, e.target.value)}
                disabled={busy !== null}
                className="field"
                style={{ width: 110, padding: "6px 8px", font: "600 12px/1 var(--font-ui)" }}
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            ) : (
              roleBadge(m.role)
            )}
            {isAdmin && m.role !== "owner" && m.email !== myEmail && (
              <button onClick={() => removeMember(m.email)} disabled={busy !== null} aria-label={`Remove ${m.email}`} className="icon-btn danger" style={{ width: 30, height: 30 }}>
                <X size={14} />
              </button>
            )}
          </div>
        ))}
      </div>

      {/* invites (admin+) */}
      {isAdmin && (
        <div className="card" style={{ padding: 24, marginBottom: 18 }}>
          <div style={{ font: "700 15px/1 var(--font-ui)", color: "var(--text)", marginBottom: 5 }}>Invite people</div>
          <div style={{ font: "400 12.5px/1.5 var(--font-ui)", color: "var(--text-muted)", marginBottom: 16 }}>
            Invites are bound to the email they&apos;re sent to and expire in 14 days.
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <input
              value={inviteInput}
              onChange={(e) => setInviteInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") invite();
              }}
              placeholder="name@company.com"
              className="field"
              style={{ flex: 1, minWidth: 200 }}
            />
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as "member" | "admin")}
              className="field"
              style={{ width: 110 }}
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
            <button onClick={invite} disabled={busy !== null || !inviteInput.trim()} className="btn btn-primary">
              <Plus size={15} />
              {busy === "invite" ? "Inviting…" : "Invite"}
            </button>
          </div>
          {lastInviteUrl && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, padding: "10px 12px", borderRadius: "var(--r-md)", background: "var(--surface-2)", border: "1px solid var(--border-strong)" }}>
              <span className="mb-mono" style={{ flex: 1, font: "500 12px/1 var(--font-mono)", color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {lastInviteUrl}
              </span>
              <button onClick={copyInviteUrl} className="btn btn-neutral" style={{ padding: "6px 11px", font: "600 12px/1 var(--font-ui)" }}>
                <Copy size={12} />
                {copiedInvite ? "Copied" : "Copy link"}
              </button>
            </div>
          )}
          {invites.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div className="lbl">Pending</div>
              {invites.map((inv) => (
                <div key={inv.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderTop: "1px solid var(--border)" }}>
                  <Clock size={13} style={{ color: "var(--warning)", flex: "none" }} />
                  <span style={{ flex: 1, font: "500 12.5px/1.2 var(--font-ui)", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {inv.email}
                  </span>
                  {roleBadge(inv.role)}
                  <button onClick={() => revokeInvite(inv.id)} disabled={busy !== null} aria-label="Revoke" className="icon-btn danger" style={{ width: 28, height: 28 }}>
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* workspace sites */}
      {sites.length > 0 && (
        <div className="card" style={{ padding: 24, marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, font: "700 15px/1 var(--font-ui)", color: "var(--text)", marginBottom: 14 }}>
            <Globe size={15} />
            Sites in this workspace
          </div>
          {sites.map((s, i) => {
            const expired = new Date(s.expiresAt).getTime() <= Date.now();
            return (
              <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 0", borderTop: i === 0 ? "none" : "1px solid var(--border)" }}>
                <a href={`/s/${s.slug}`} target="_blank" rel="noreferrer" className="mb-mono" style={{ font: "600 13px/1.2 var(--font-mono)", color: expired ? "var(--text-subtle)" : "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
                  {s.slug}
                </a>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: 999, background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text-muted)", font: "600 10px/1 var(--font-ui)", whiteSpace: "nowrap" }}>
                  {s.visibility === "team" ? <Users size={10} /> : s.visibility === "only_me" ? <Lock size={10} /> : <Mail size={10} />}
                  {s.visibility === "team" ? "Team" : s.visibility === "only_me" ? "Only owner" : "Allowlist"}
                </span>
                <span className="mb-mono" style={{ font: "500 11px/1 var(--font-mono)", color: "var(--text-subtle)", whiteSpace: "nowrap" }}>
                  {s.owner === myEmail ? "you" : s.owner.split("@")[0]} · {sizeLabel(s.sizeBytes)}
                </span>
                {expired ? (
                  <span style={{ font: "600 10.5px/1 var(--font-ui)", color: "var(--danger)", whiteSpace: "nowrap" }}>expired</span>
                ) : (
                  isAdmin && (
                    <>
                      <button
                        onClick={() =>
                          confirm(`Force-expire "${s.slug}"? It stops being served immediately.`) &&
                          call(`fexp-${s.id}`, () =>
                            fetch(`/api/sites/${s.id}`, {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ action: "force_expire" }),
                            }),
                          "Site force-expired.")
                        }
                        disabled={busy !== null}
                        aria-label="Force expire"
                        title="Force expire"
                        className="icon-btn"
                        style={{ width: 28, height: 28 }}
                      >
                        <TimerOff size={13} />
                      </button>
                      <button
                        onClick={() =>
                          confirm(`Move "${s.slug}" to trash?`) &&
                          call(`trash-${s.id}`, () =>
                            fetch(`/api/sites/${s.id}`, { method: "DELETE" }),
                          "Site moved to trash.")
                        }
                        disabled={busy !== null}
                        aria-label="Trash"
                        title="Move to trash"
                        className="icon-btn danger"
                        style={{ width: 28, height: 28 }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </>
                  )
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* audit log (admin+) */}
      {isAdmin && audit.length > 0 && (
        <div className="card" style={{ padding: 24, marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, font: "700 15px/1 var(--font-ui)", color: "var(--text)", marginBottom: 5 }}>
            <ScrollText size={15} />
            Audit log
          </div>
          <div style={{ font: "400 12.5px/1.5 var(--font-ui)", color: "var(--text-muted)", marginBottom: 14 }}>
            Last 30 days of workspace activity.
          </div>
          {audit.map((a, i) => (
            <div key={i} style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "8px 0", borderTop: i === 0 ? "none" : "1px solid var(--border)" }}>
              <span className="mb-mono" style={{ font: "500 10.5px/1.3 var(--font-mono)", color: "var(--text-subtle)", flex: "none", width: 74 }}>
                {agoShort(a.at)}
              </span>
              <span style={{ font: "400 12.5px/1.5 var(--font-ui)", color: "var(--text-muted)", minWidth: 0 }}>
                {auditLabel(a)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* billing */}
      {billing && <BillingCard info={billing} />}

      {/* settings (admin+) */}
      {isAdmin && (
        <div className="card" style={{ padding: 24, marginBottom: 18 }}>
          <div style={{ font: "700 15px/1 var(--font-ui)", color: "var(--text)", marginBottom: 16 }}>Settings</div>
          <label className="lbl">Workspace name</label>
          <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
            <input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} className="field" style={{ flex: 1 }} />
            <button onClick={rename} disabled={busy !== null || nameDraft.trim() === workspace.name} className="btn btn-neutral">
              <Pencil size={14} />
              Rename
            </button>
          </div>
          <label className="lbl">Maximum TTL for team sites</label>
          <div className="seg-group">
            <button className={`seg${maxTtl === null ? " active" : ""}`} onClick={() => saveMaxTtl(null)}>
              <Check size={14} />
              Plan max
            </button>
            {(["24h", "7d", "30d"] as const).map((k) => (
              <button key={k} className={`seg${maxTtl === k ? " active" : ""}`} onClick={() => saveMaxTtl(k)}>
                <Clock size={14} />
                {TTL_LABEL[k]}
              </button>
            ))}
          </div>
          <div className="hint">
            <Shield size={12} />
            Caps the TTL presets members can pick for sites in this workspace.
          </div>
        </div>
      )}

      {/* leave */}
      {!isOwner ? (
        <div className="card" style={{ padding: 24 }}>
          <div style={{ font: "700 15px/1 var(--font-ui)", color: "var(--text)", marginBottom: 5 }}>Leave workspace</div>
          <div style={{ font: "400 12.5px/1.5 var(--font-ui)", color: "var(--text-muted)", marginBottom: 16 }}>
            You lose access to this workspace&apos;s team sites immediately.
          </div>
          <button onClick={leave} disabled={busy !== null} className="btn btn-danger">
            <LogOut size={14} />
            {busy === "leave" ? "Leaving…" : "Leave workspace"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function UsageStat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: "14px 16px", borderRadius: "var(--r-md)", background: "var(--surface-2)", border: "1px solid var(--border)" }}>
      <div style={{ font: "600 11px/1 var(--font-ui)", color: "var(--text-subtle)", marginBottom: 8 }}>{label}</div>
      <div style={{ font: "800 19px/1 var(--font-ui)", color: "var(--text)" }}>{value}</div>
    </div>
  );
}

function sizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
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

function auditLabel(a: AuditEntry): string {
  const who = a.actor ? a.actor.split("@")[0] : "system";
  const site = a.slug ? `"${a.slug}"` : "a site";
  const meta = a.meta as Record<string, string | number | boolean | undefined>;
  switch (a.type) {
    case "workspace_created": return `${who} created the workspace`;
    case "workspace_renamed": return `${who} renamed the workspace to "${meta.name}"`;
    case "member_invited": return `${who} invited ${meta.invitee} as ${meta.role}`;
    case "member_joined": return `${who} joined as ${meta.role}`;
    case "member_removed": return meta.self ? `${meta.member} left the workspace` : `${who} removed ${meta.member}`;
    case "member_role_changed": return `${who} made ${meta.member} ${meta.role}`;
    case "ttl_policy_changed": return `${who} set max TTL to ${meta.maxTtl ?? "plan max"}`;
    case "site_created": return `${who} published ${site}`;
    case "visibility_changed": return `${who} changed ${site} visibility to ${meta.to}`;
    case "site_force_expired": return `${who} force-expired ${site}`;
    case "site_trashed": return meta.by === "cron" ? `${site} expired and moved to trash` : `${who} moved ${site} to trash`;
    case "site_restored": return `${who} restored ${site}`;
    case "site_purged": return `${site} permanently deleted`;
    case "ttl_extended": return `${who} extended ${site} TTL to ${meta.ttl}`;
    case "slug_renamed": return `${who} renamed "${meta.from}" to "${meta.to}"`;
    case "subscription_updated": return `subscription updated (${meta.status ?? ""})`;
    default: return `${who}: ${a.type}`;
  }
}
