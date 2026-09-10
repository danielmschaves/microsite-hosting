import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { query, type WorkspaceRow } from "@/lib/db";
import { getMembership, roleAtLeast } from "@/lib/teams";
import { isFlagEnabled } from "@/lib/flags";
import { listAgentClients, listAgentTokens } from "@/lib/agentTokens";
import { FREE_SITE_LIMIT, FREE_STORAGE_BYTES } from "@/lib/plan";
import { AppBar } from "@/components/AppBar";
import { AgentConsolePanel } from "@/components/AgentConsolePanel";

export const dynamic = "force-dynamic";

// Agent Console (CD-10, DS-03): connected clients, tokens with scope chips,
// last-used, revoke, agent activity feed. Nested under the workspace it
// belongs to since agent tokens are workspace-scoped, gated by
// agent_console_ui so it can ship UI-complete before CD-06/07 are trusted in
// production.
export default async function TeamAgentsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) redirect("/");

  if (!(await isFlagEnabled("agent_console_ui", id))) {
    notFound();
  }

  const rows = await query<WorkspaceRow>("SELECT * FROM workspaces WHERE id = $1", [id]).catch(
    () => [] as WorkspaceRow[],
  );
  const workspace = rows[0];
  if (!workspace) notFound();

  const myRole = await getMembership(email, id);
  if (!myRole) notFound();
  const isAdmin = roleAtLeast(myRole, "admin");

  const clients = isAdmin ? await listAgentClients(id) : [];
  const tokens = isAdmin ? await listAgentTokens(id) : [];

  const mySites = await query<{ size_bytes: string }>(
    "SELECT size_bytes FROM sites WHERE owner_email = $1 AND deleted_at IS NULL",
    [email],
  );
  const usedBytes = mySites.reduce((s, r) => s + Number(r.size_bytes), 0);

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
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "30px 30px 100px" }}>
        <h1 style={{ font: "800 26px/1 var(--font-ui)", color: "var(--text)" }}>Agents</h1>
        <p
          style={{
            font: "400 13.5px/1 var(--font-ui)",
            color: "var(--text-muted)",
            marginTop: 8,
            marginBottom: 24,
          }}
        >
          Connected AI agents for {workspace.name}. Agents authorize through your browser — no
          token to paste.
        </p>
        {isAdmin ? (
          <AgentConsolePanel workspaceId={id} clients={clients} tokens={tokens} />
        ) : (
          <div className="card" style={{ padding: 20 }}>
            <div style={{ font: "400 13.5px/1.5 var(--font-ui)", color: "var(--text-muted)" }}>
              Only workspace admins can manage connected agents.
            </div>
          </div>
        )}
      </div>
    </>
  );
}
