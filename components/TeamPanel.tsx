"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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

export function TeamPanel({
  workspace,
  myRole,
  myEmail,
  members,
  invites,
}: {
  workspace: { id: string; name: string; plan: string; maxTtl: string | null };
  myRole: string;
  myEmail: string;
  members: TeamMember[];
  invites: TeamInvite[];
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
      {!isOwner && (
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
      )}
    </div>
  );
}
