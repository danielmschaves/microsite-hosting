import { query, type SiteRow } from "./db";

// Workspace-scoped site lookup for app/api/agent/** routes. Deliberately NOT
// the v1 API's ownedSite() (owner-email based, no workspace concept) — agent
// tokens are workspace-scoped by design, so access is checked via
// sites.workspace_id = agent_tokens.workspace_id directly, sidestepping the
// v1 API's per-owner-only gap rather than inheriting it (see CLAUDE.md's
// Agent Gateway risk notes).
export async function agentOwnedSite(id: string, workspaceId: string): Promise<SiteRow | null> {
  let rows: SiteRow[] = [];
  try {
    rows = await query<SiteRow>(
      "SELECT * FROM sites WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL AND purged_at IS NULL",
      [id, workspaceId],
    );
  } catch {
    return null; // invalid uuid
  }
  return rows[0] ?? null;
}
