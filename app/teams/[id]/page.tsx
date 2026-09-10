import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { query, type WorkspaceRow } from "@/lib/db";
import { getMembership } from "@/lib/teams";
import {
  FREE_SITE_LIMIT,
  FREE_STORAGE_BYTES,
  MIN_TEAM_SEATS,
  billingEnabled,
  fakeTeam,
  planForWorkspace,
} from "@/lib/plan";
import { AppBar } from "@/components/AppBar";
import { TeamPanel } from "@/components/TeamPanel";
import { isFlagEnabled } from "@/lib/flags";

export const dynamic = "force-dynamic";

export default async function TeamPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) redirect("/");

  const rows = await query<WorkspaceRow>(
    "SELECT * FROM workspaces WHERE id = $1",
    [id],
  ).catch(() => [] as WorkspaceRow[]);
  const workspace = rows[0];
  if (!workspace) notFound();

  const myRole = await getMembership(email, id);
  if (!myRole) notFound();

  const agentGatewayEnabled = await isFlagEnabled("agent_console_ui", id);

  const members = await query<{ email: string; role: string; joined_at: Date }>(
    `SELECT email, role, joined_at FROM workspace_members
      WHERE workspace_id = $1
      ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, email`,
    [id],
  );

  const invites =
    myRole === "member"
      ? []
      : await query<{ id: string; email: string; role: string; expires_at: Date }>(
          `SELECT id, email, role, expires_at FROM workspace_invites
            WHERE workspace_id = $1 AND accepted_at IS NULL AND expires_at > now()
            ORDER BY created_at DESC`,
          [id],
        );

  const mySites = await query<{ size_bytes: string }>(
    "SELECT size_bytes FROM sites WHERE owner_email = $1 AND deleted_at IS NULL",
    [email],
  );
  const usedBytes = mySites.reduce((s, r) => s + Number(r.size_bytes), 0);

  // Workspace sites (live) for the Usage + Sites sections.
  const wsSites = await query<{
    id: string;
    slug: string;
    owner_email: string;
    size_bytes: string;
    visibility: string;
    expires_at: Date;
  }>(
    `SELECT id, slug, owner_email, size_bytes, visibility, expires_at
       FROM sites
      WHERE workspace_id = $1 AND deleted_at IS NULL
      ORDER BY created_at DESC`,
    [id],
  );

  // Audit entries (team plan, admins only) straight from events.
  const wsPlan = planForWorkspace(workspace);
  const audit =
    myRole === "member" || wsPlan.auditDays === 0
      ? []
      : await query<{
          type: string;
          actor: string | null;
          meta: Record<string, unknown>;
          created_at: Date;
          slug: string | null;
        }>(
          `SELECT e.type, e.actor, e.meta, e.created_at, s.slug
             FROM events e LEFT JOIN sites s ON s.id = e.site_id
            WHERE e.workspace_id = $1
              AND e.type <> 'site_view'
              AND e.created_at > now() - make_interval(days => $2)
            ORDER BY e.created_at DESC
            LIMIT 100`,
          [id, wsPlan.auditDays],
        );

  return (
    <>
      <AppBar
        email={email}
        name={session?.user?.name}
        active="teams"
        usedBytes={usedBytes}
        siteCount={mySites.length}
        siteLimit={FREE_SITE_LIMIT}
        storageLimitBytes={FREE_STORAGE_BYTES}
      />
      <TeamPanel
        workspace={{
          id: workspace.id,
          name: workspace.name,
          plan: workspace.plan,
          maxTtl: workspace.max_ttl_preset,
        }}
        myRole={myRole}
        myEmail={email}
        members={members.map((m) => ({
          email: m.email,
          role: m.role,
          joinedAt: new Date(m.joined_at).toISOString(),
        }))}
        invites={invites.map((i) => ({
          id: i.id,
          email: i.email,
          role: i.role,
          expiresAt: new Date(i.expires_at).toISOString(),
        }))}
        sites={wsSites.map((s) => ({
          id: s.id,
          slug: s.slug,
          owner: s.owner_email,
          sizeBytes: Number(s.size_bytes),
          visibility: s.visibility,
          expiresAt: new Date(s.expires_at).toISOString(),
        }))}
        audit={audit.map((a) => ({
          type: a.type,
          actor: a.actor,
          slug: a.slug,
          meta: a.meta,
          at: new Date(a.created_at).toISOString(),
        }))}
        billing={{
          workspaceId: workspace.id,
          plan: workspace.plan,
          status: workspace.subscription_status,
          seats: workspace.seats,
          memberCount: members.length,
          isOwner: myRole === "owner",
          billingEnabled,
          fakeTeam,
          minSeats: MIN_TEAM_SEATS,
        }}
        agentGatewayEnabled={agentGatewayEnabled}
      />
    </>
  );
}
