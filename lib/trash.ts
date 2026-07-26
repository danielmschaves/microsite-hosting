import { query } from "./db";
import { TRASH_DAYS } from "./plan";
import { roleAtLeast, type Role } from "./teams";

// Trash queries shared by /trash and the dashboard's trash link.

export interface TrashItem {
  id: string;
  slug: string;
  sizeBytes: number;
  owner: string;
  reason: "expired" | "deleted";
  purgeAt: string; // ISO — deleted_at + TRASH_DAYS
}

export interface WorkspaceTrash {
  workspaceId: string;
  workspaceName: string;
  items: TrashItem[];
}

interface TrashRow {
  id: string;
  slug: string;
  size_bytes: string;
  owner_email: string;
  deleted_at: Date;
  expires_at: Date;
}

function toItem(r: TrashRow): TrashItem {
  return {
    id: r.id,
    slug: r.slug,
    sizeBytes: Number(r.size_bytes),
    owner: r.owner_email,
    // Sites the cron trashed on expiry have expires_at <= deleted_at.
    reason:
      new Date(r.expires_at).getTime() <= new Date(r.deleted_at).getTime()
        ? "expired"
        : "deleted",
    purgeAt: new Date(
      new Date(r.deleted_at).getTime() + TRASH_DAYS * 24 * 3600 * 1000,
    ).toISOString(),
  };
}

/** The caller's own trashed (not yet purged) sites. */
export async function personalTrash(email: string): Promise<TrashItem[]> {
  const rows = await query<TrashRow>(
    `SELECT id, slug, size_bytes, owner_email, deleted_at, expires_at
       FROM sites
      WHERE lower(owner_email) = $1 AND deleted_at IS NOT NULL AND purged_at IS NULL
      ORDER BY deleted_at DESC`,
    [email.toLowerCase()],
  );
  return rows.map(toItem);
}

/**
 * Trashed sites in every workspace where the caller is admin+ (excluding
 * their own sites — those are in the personal list). Admins can purge;
 * restore stays owner-only, matching the API guards.
 */
export async function workspaceTrashFor(email: string): Promise<WorkspaceTrash[]> {
  const memberships = await query<{ workspace_id: string; name: string; role: string }>(
    `SELECT m.workspace_id, w.name, m.role
       FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id
      WHERE m.email = $1`,
    [email.toLowerCase()],
  );
  const adminWs = memberships.filter((m) => roleAtLeast(m.role as Role, "admin"));
  if (adminWs.length === 0) return [];

  const rows = await query<TrashRow & { workspace_id: string }>(
    `SELECT id, slug, size_bytes, owner_email, deleted_at, expires_at, workspace_id
       FROM sites
      WHERE workspace_id = ANY($1::uuid[])
        AND deleted_at IS NOT NULL AND purged_at IS NULL
        AND lower(owner_email) <> $2
      ORDER BY deleted_at DESC`,
    [adminWs.map((w) => w.workspace_id), email.toLowerCase()],
  );

  const byWs = new Map<string, TrashItem[]>();
  for (const r of rows) {
    const list = byWs.get(r.workspace_id) ?? [];
    list.push(toItem(r));
    byWs.set(r.workspace_id, list);
  }
  return adminWs
    .filter((w) => byWs.has(w.workspace_id))
    .map((w) => ({
      workspaceId: w.workspace_id,
      workspaceName: w.name,
      items: byWs.get(w.workspace_id)!,
    }));
}
