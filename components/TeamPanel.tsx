"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BillingCard, type BillingInfo } from "@/components/BillingCard";
import { Banner } from "@/components/ui";
import { FREE_PLAN, TEAM_PLAN } from "@/lib/plan";
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
  Timer,
  Trash2,
  LayoutGrid,
  Download,
  UserPlus,
  Building2,
  Bot,
  CheckCircle2,
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

const SITE_GRID = "1.6fr 1fr .9fr .7fr .6fr auto";

export function TeamPanel({
  workspace,
  myRole,
  myEmail,
  members,
  invites,
  sites = [],
  audit = [],
  billing,
  agentGatewayEnabled = false,
  pendingApprovals = 0,
}: {
  workspace: { id: string; name: string; plan: string; maxTtl: string | null };
  myRole: string;
  myEmail: string;
  members: TeamMember[];
  invites: TeamInvite[];
  sites?: TeamSite[];
  audit?: AuditEntry[];
  billing?: BillingInfo;
  agentGatewayEnabled?: boolean;
  pendingApprovals?: number;
}) {
  const router = useRouter();
  const isAdmin = myRole === "admin" || myRole === "owner";
  const isOwner = myRole === "owner";
  const plan = workspace.plan === "team" ? TEAM_PLAN : FREE_PLAN;

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [inviteInput, setInviteInput] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "admin">("member");
  const [lastInviteUrl, setLastInviteUrl] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState(workspace.name);
  const [maxTtl, setMaxTtl] = useState<string | null>(workspace.maxTtl);
  const [copiedInvite, setCopiedInvite] = useState(false);
  const inviteRef = useRef<HTMLDivElement>(null);

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

  function exportAuditCsv() {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const lines = [
      "at,type,actor,site,detail",
      ...audit.map((a) =>
        [
          esc(a.at),
          esc(a.type),
          esc(a.actor ?? "system"),
          esc(a.slug ?? ""),
          esc(auditLabel(a)),
        ].join(","),
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${workspace.name.replace(/\s+/g, "-").toLowerCase()}-audit.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const expiring24h = sites.filter((s) => {
    const ms = new Date(s.expiresAt).getTime() - Date.now();
    return ms > 0 && ms <= 24 * 3600 * 1000;
  }).length;

  const roleBadge = (role: string) => (
    <span
      className={`pill ${role === "owner" || role === "admin" ? "pill-accent" : ""}`}
      style={{ textTransform: "capitalize" }}
    >
      {role === "owner" ? <Crown size={11} /> : role === "admin" ? <Shield size={11} /> : null}
      {role}
    </span>
  );

  const visPill = (v: string) => {
    if (v === "public")
      return (
        <span className="pill pill-warning">
          <Globe size={11} />
          Public
        </span>
      );
    if (v === "team")
      return (
        <span className="pill pill-neutral">
          <Building2 size={11} />
          Team
        </span>
      );
    if (v === "only_me")
      return (
        <span className="pill pill-neutral">
          <Lock size={11} />
          Only owner
        </span>
      );
    return (
      <span className="pill pill-accent">
        <Mail size={11} />
        Allowlist
      </span>
    );
  };

  return (
    <div style={{ maxWidth: 1160, margin: "0 auto", padding: "30px 30px 100px" }}>
      <div style={{ marginBottom: 12 }}>
        <Link
          href="/teams"
          className="btn btn-ghost"
          style={{ padding: "5px 9px", font: "600 12px/1 var(--font-ui)" }}
        >
          <ArrowLeft size={14} />
          Teams
        </Link>
      </div>

      {/* header */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 20,
          flexWrap: "wrap",
          marginBottom: 24,
        }}
      >
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
              marginBottom: 7,
            }}
          >
            <h1
              style={{
                margin: 0,
                font: "800 26px/1 var(--font-ui)",
                letterSpacing: "-.02em",
                color: "var(--text)",
              }}
            >
              {workspace.name}
            </h1>
            {isAdmin && (
              <span className="pill pill-accent">
                <Shield size={11} style={{ color: "var(--accent)" }} />
                <span className="mb-mono">{myRole.toUpperCase()}</span>
              </span>
            )}
            <span className={`pill ${workspace.plan === "team" ? "pill-accent" : ""}`}>
              {workspace.plan === "team" ? "Team plan" : "Free"}
            </span>
          </div>
          <p style={{ margin: 0, font: "400 13.5px/1 var(--font-ui)", color: "var(--text-muted)" }}>
            {isAdmin
              ? "Everything published under your team, and who touched it."
              : `${members.length} member${members.length === 1 ? "" : "s"} · your role: ${myRole}`}
          </p>
        </div>
        {isAdmin && (
          <div style={{ display: "flex", gap: 10 }}>
            {agentGatewayEnabled && (
              <>
                <Link
                  href={`/teams/${workspace.id}/approvals`}
                  className="btn btn-neutral"
                  style={{ position: "relative" }}
                >
                  <CheckCircle2 size={16} />
                  Approvals
                  {pendingApprovals > 0 && (
                    <span
                      className="mb-mono"
                      style={{
                        marginLeft: 2,
                        padding: "1px 6px",
                        borderRadius: 999,
                        background: "var(--warning)",
                        color: "#1a1200",
                        font: "700 10.5px/1.4 var(--font-mono)",
                      }}
                    >
                      {pendingApprovals}
                    </span>
                  )}
                </Link>
                <Link href={`/teams/${workspace.id}/agents`} className="btn btn-neutral">
                  <Bot size={16} />
                  Agents
                </Link>
              </>
            )}
            <button
              onClick={() =>
                inviteRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })
              }
              className="btn btn-primary"
            >
              <UserPlus size={16} />
              Invite member
            </button>
          </div>
        )}
      </div>

      {(notice || error) && (
        <div style={{ marginBottom: 16 }}>
          <Banner tone={error ? "danger" : "success"}>{error || notice}</Banner>
        </div>
      )}

      {/* stat tiles */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4,1fr)",
          gap: 14,
          marginBottom: 24,
        }}
      >
        <div className="stat-tile">
          <div className="stat-label">
            <LayoutGrid size={12} />
            Active sites
          </div>
          <div className="stat-value">
            {sites.length}
            <span className="stat-unit"> / {plan.siteLimit}</span>
          </div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">
            <HardDrive size={12} />
            Storage
          </div>
          <div className="stat-value">
            {sizeParts(sites.reduce((s, x) => s + x.sizeBytes, 0)).value}
            <span className="stat-unit">
              {" "}
              {sizeParts(sites.reduce((s, x) => s + x.sizeBytes, 0)).unit}
            </span>
          </div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">
            <Users size={12} />
            Members
          </div>
          <div className="stat-value">
            {members.length}
            {billing && billing.seats > 0 && (
              <span className="stat-unit"> / {billing.seats} seats</span>
            )}
          </div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">
            <Timer size={12} />
            Expiring 24h
          </div>
          <div
            className="stat-value"
            style={expiring24h > 0 ? { color: "var(--warning)" } : undefined}
          >
            {expiring24h}
          </div>
        </div>
      </div>

      {/* all team sites */}
      {sites.length > 0 && (
        <div className="card" style={{ overflow: "hidden", marginBottom: 20 }}>
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
            <div style={{ font: "700 15px/1 var(--font-ui)", color: "var(--text)" }}>
              All team sites
            </div>
            <span
              className="mb-mono"
              style={{ font: "500 11px/1 var(--font-mono)", color: "var(--text-subtle)" }}
            >
              {sites.length} live
            </span>
          </div>
          <div className="tbl-head" style={{ gridTemplateColumns: SITE_GRID }}>
            <span>Site</span>
            <span>Owner</span>
            <span>Visibility</span>
            <span>Expires</span>
            <span>Size</span>
            <span />
          </div>
          {sites.map((s) => {
            const ms = new Date(s.expiresAt).getTime() - Date.now();
            const expired = ms <= 0;
            const soon = !expired && ms <= 24 * 3600 * 1000;
            return (
              <div
                key={s.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: SITE_GRID,
                  gap: 14,
                  alignItems: "center",
                  padding: "13px 20px",
                  borderTop: "1px solid var(--border)",
                }}
              >
                <a
                  href={`/s/${s.slug}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    font: "600 13px/1.2 var(--font-ui)",
                    color: expired ? "var(--text-subtle)" : "var(--text)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {s.slug}
                </a>
                <span
                  className="mb-mono"
                  style={{
                    font: "500 12px/1 var(--font-mono)",
                    color: "var(--text-muted)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {s.owner === myEmail ? "you" : s.owner}
                </span>
                {visPill(s.visibility)}
                <span
                  className="mb-mono"
                  style={{
                    font: "500 11.5px/1 var(--font-mono)",
                    color: expired
                      ? "var(--danger)"
                      : soon
                        ? "var(--warning)"
                        : "var(--text-muted)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {expired ? "expired" : timeLeft(s.expiresAt)}
                </span>
                <span
                  className="mb-mono"
                  style={{
                    font: "500 11.5px/1 var(--font-mono)",
                    color: "var(--text-subtle)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {sizeLabel(s.sizeBytes)}
                </span>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    justifyContent: "flex-end",
                  }}
                >
                  {isAdmin && !expired && (
                    <>
                      <button
                        onClick={() =>
                          confirm(
                            `Force-expire "${s.slug}"? It stops being served immediately.`,
                          ) &&
                          call(
                            `fexp-${s.id}`,
                            () =>
                              fetch(`/api/sites/${s.id}`, {
                                method: "PATCH",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ action: "force_expire" }),
                              }),
                            "Site force-expired.",
                          )
                        }
                        disabled={busy !== null}
                        className="btn btn-ghost"
                        style={{
                          padding: "6px 10px",
                          font: "600 11.5px/1 var(--font-ui)",
                          border: "1px solid var(--border-strong)",
                          whiteSpace: "nowrap",
                        }}
                      >
                        <TimerOff size={12} />
                        Force-expire
                      </button>
                      <button
                        onClick={() =>
                          confirm(`Move "${s.slug}" to trash?`) &&
                          call(
                            `trash-${s.id}`,
                            () => fetch(`/api/sites/${s.id}`, { method: "DELETE" }),
                            "Site moved to trash.",
                          )
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
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* members ∥ audit */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: isAdmin && audit.length > 0 ? "1fr 1fr" : "1fr",
          gap: 20,
          alignItems: "start",
          marginBottom: 20,
        }}
      >
        <div className="card" style={{ overflow: "hidden" }}>
          <div style={{ padding: "17px 20px", borderBottom: "1px solid var(--border)" }}>
            <div style={{ font: "700 15px/1 var(--font-ui)", color: "var(--text)" }}>Members</div>
            <div
              style={{
                font: "400 12px/1.4 var(--font-ui)",
                color: "var(--text-muted)",
                marginTop: 5,
              }}
            >
              Workspace membership grants access to team-visible sites.
            </div>
          </div>
          {members.map((m) => (
            <div
              key={m.email}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 11,
                padding: "13px 20px",
                borderTop: "1px solid var(--border)",
              }}
            >
              <span
                style={{
                  display: "grid",
                  placeItems: "center",
                  width: 30,
                  height: 30,
                  borderRadius: 999,
                  background: "var(--accent-soft)",
                  border: "1px solid var(--accent-border)",
                  color: "var(--text)",
                  font: "700 11px/1 var(--font-ui)",
                  flex: "none",
                }}
              >
                {m.email.slice(0, 2).toUpperCase()}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    font: "600 12.5px/1.2 var(--font-ui)",
                    color: "var(--text)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {m.email}
                  {m.email === myEmail && (
                    <span
                      className="mb-mono"
                      style={{ color: "var(--text-subtle)", font: "500 11px/1 var(--font-mono)" }}
                    >
                      {" "}
                      (you)
                    </span>
                  )}
                </div>
                <div
                  className="mb-mono"
                  style={{
                    font: "500 10.5px/1 var(--font-mono)",
                    color: "var(--text-subtle)",
                    marginTop: 4,
                  }}
                >
                  joined {agoShort(m.joinedAt)}
                </div>
              </div>
              {isOwner && m.role !== "owner" ? (
                <select
                  value={m.role}
                  onChange={(e) => setRole(m.email, e.target.value)}
                  disabled={busy !== null}
                  className="field"
                  style={{ width: 100, padding: "6px 8px", font: "600 12px/1 var(--font-ui)" }}
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
              ) : (
                roleBadge(m.role)
              )}
              {isAdmin && m.role !== "owner" && m.email !== myEmail && (
                <button
                  onClick={() => removeMember(m.email)}
                  disabled={busy !== null}
                  aria-label={`Remove ${m.email}`}
                  className="icon-btn danger"
                  style={{ width: 28, height: 28 }}
                >
                  <X size={13} />
                </button>
              )}
            </div>
          ))}
        </div>

        {isAdmin && audit.length > 0 && (
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
                <div style={{ font: "700 15px/1 var(--font-ui)", color: "var(--text)" }}>
                  Audit log
                </div>
                <div
                  style={{
                    font: "400 12px/1.4 var(--font-ui)",
                    color: "var(--text-muted)",
                    marginTop: 5,
                  }}
                >
                  Uploads, access changes, deletions.
                </div>
              </div>
              <button
                onClick={exportAuditCsv}
                className="btn btn-neutral"
                style={{ padding: "7px 11px", font: "600 11.5px/1 var(--font-ui)" }}
              >
                <Download size={12} />
                Export
              </button>
            </div>
            <div style={{ maxHeight: 420, overflowY: "auto" }}>
              {audit.map((a, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 11,
                    padding: "12px 20px",
                    borderTop: i === 0 ? "none" : "1px solid var(--border)",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ font: "500 12.5px/1.4 var(--font-ui)", color: "var(--text)" }}>
                      {auditLabel(a)}
                    </div>
                    <div
                      className="mb-mono"
                      style={{
                        font: "500 10.5px/1 var(--font-mono)",
                        color: "var(--text-subtle)",
                        marginTop: 4,
                      }}
                    >
                      {a.actor ?? "system"} · {agoShort(a.at)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* invites (admin+) */}
      {isAdmin && (
        <div ref={inviteRef} className="card" style={{ padding: 24, marginBottom: 18 }}>
          <div style={{ font: "700 15px/1 var(--font-ui)", color: "var(--text)", marginBottom: 5 }}>
            Invite people
          </div>
          <div
            style={{
              font: "400 12.5px/1.5 var(--font-ui)",
              color: "var(--text-muted)",
              marginBottom: 16,
            }}
          >
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
            <button
              onClick={invite}
              disabled={busy !== null || !inviteInput.trim()}
              className="btn btn-primary"
            >
              <Plus size={15} />
              {busy === "invite" ? "Inviting…" : "Invite"}
            </button>
          </div>
          {lastInviteUrl && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginTop: 14,
                padding: "10px 12px",
                borderRadius: "var(--r-md)",
                background: "var(--surface-2)",
                border: "1px solid var(--border-strong)",
              }}
            >
              <span
                className="mb-mono"
                style={{
                  flex: 1,
                  font: "500 12px/1 var(--font-mono)",
                  color: "var(--text)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {lastInviteUrl}
              </span>
              <button
                onClick={copyInviteUrl}
                className="btn btn-neutral"
                style={{ padding: "6px 11px", font: "600 12px/1 var(--font-ui)" }}
              >
                <Copy size={12} />
                {copiedInvite ? "Copied" : "Copy link"}
              </button>
            </div>
          )}
          {invites.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div className="lbl">Pending</div>
              {invites.map((inv) => (
                <div
                  key={inv.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "9px 0",
                    borderTop: "1px solid var(--border)",
                  }}
                >
                  <Clock size={13} style={{ color: "var(--warning)", flex: "none" }} />
                  <span
                    style={{
                      flex: 1,
                      font: "500 12.5px/1.2 var(--font-ui)",
                      color: "var(--text-muted)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {inv.email}
                  </span>
                  {roleBadge(inv.role)}
                  <button
                    onClick={() => revokeInvite(inv.id)}
                    disabled={busy !== null}
                    aria-label="Revoke"
                    className="icon-btn danger"
                    style={{ width: 28, height: 28 }}
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* billing */}
      {billing && <BillingCard info={billing} />}

      {/* settings (admin+) */}
      {isAdmin && (
        <div className="card" style={{ padding: 24, marginBottom: 18 }}>
          <div style={{ font: "700 15px/1 var(--font-ui)", color: "var(--text)", marginBottom: 16 }}>
            Settings
          </div>
          <label className="lbl">Workspace name</label>
          <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
            <input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              className="field"
              style={{ flex: 1 }}
            />
            <button
              onClick={rename}
              disabled={busy !== null || nameDraft.trim() === workspace.name}
              className="btn btn-neutral"
            >
              <Pencil size={14} />
              Rename
            </button>
          </div>
          <label className="lbl">Maximum TTL for team sites</label>
          <div className="seg-group">
            <button
              className={`seg${maxTtl === null ? " active" : ""}`}
              onClick={() => saveMaxTtl(null)}
            >
              <Check size={14} />
              Plan max
            </button>
            {(["24h", "7d", "30d"] as const).map((k) => (
              <button
                key={k}
                className={`seg${maxTtl === k ? " active" : ""}`}
                onClick={() => saveMaxTtl(k)}
              >
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
          <div style={{ font: "700 15px/1 var(--font-ui)", color: "var(--text)", marginBottom: 5 }}>
            Leave workspace
          </div>
          <div
            style={{
              font: "400 12.5px/1.5 var(--font-ui)",
              color: "var(--text-muted)",
              marginBottom: 16,
            }}
          >
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

function sizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function sizeParts(bytes: number): { value: string; unit: string } {
  if (bytes >= 1024 * 1024 * 1024)
    return { value: (bytes / (1024 * 1024 * 1024)).toFixed(1), unit: "GB" };
  if (bytes >= 1024 * 1024)
    return { value: (bytes / (1024 * 1024)).toFixed(1), unit: "MB" };
  return { value: String(Math.max(1, Math.round(bytes / 1024))), unit: "KB" };
}

function timeLeft(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "expired";
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return `${Math.max(1, Math.floor(ms / 60_000))}m`;
  if (h < 48) return `${h}h ${Math.floor((ms % 3_600_000) / 60_000)}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
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
    case "site_version_published": return `${who} published ${site} v${meta.version}`;
    case "site_rolled_back": return `${who} rolled ${site} back to v${meta.to}`;
    case "index_changed": return `${who} set ${meta.to} as index on ${site}`;
    case "visibility_changed": return `${who} changed ${site} visibility to ${meta.to}`;
    case "site_force_expired": return `${who} force-expired ${site}`;
    case "site_trashed": return meta.by === "cron" ? `${site} expired and moved to trash` : `${who} moved ${site} to trash`;
    case "site_restored": return `${who} restored ${site}`;
    case "site_purged": return `${site} permanently deleted`;
    case "ttl_extended": return `${who} extended ${site} TTL to ${meta.ttl}`;
    case "slug_renamed": return `${who} renamed "${meta.from}" to "${meta.to}"`;
    case "expiry_notice_sent": return `expiry notice sent for ${site} (T-${meta.window})`;
    case "api_token_created": return `${who} created an API token`;
    case "api_token_revoked": return `${who} revoked an API token`;
    case "subscription_updated": return `subscription updated (${meta.status ?? ""})`;
    default: return `${who}: ${a.type}`;
  }
}
