import { query } from "./db";

// ---------------------------------------------------------------------------
// Feature flags (PRD v2.0 §12.2): every Agent Gateway work order ships dark
// until its release gate passes. Resolution order mirrors lib/plan.ts's
// planForWorkspace — an env var is the ops kill-switch (always wins, same
// pattern as billingEnabled/fakeTeam/devLogin), the `feature_flags` table is
// the per-workspace / global fallback for turning things on without a
// redeploy.
// ---------------------------------------------------------------------------

export type FlagName =
  | "agent_gateway"
  | "agent_oauth"
  | "agent_console_ui"
  | "deployment_serving";

export const ALL_FLAGS: FlagName[] = [
  "agent_gateway",
  "agent_oauth",
  "agent_console_ui",
  "deployment_serving",
];

function envOverride(name: FlagName): boolean | null {
  const raw = process.env[`MICROBUILD_FLAG_${name.toUpperCase()}`];
  if (raw === "true") return true;
  if (raw === "false") return false;
  return null;
}

interface FeatureFlagRow {
  name: string;
  enabled_globally: boolean;
  enabled_workspaces: string[];
}

/**
 * Is `name` enabled? An env override always wins. Otherwise falls through to
 * the `feature_flags` table: enabled_globally, or workspaceId is in the
 * per-workspace allowlist. Missing row = disabled (safe default for a
 * gateway that must ship dark).
 */
export async function isFlagEnabled(
  name: FlagName,
  workspaceId?: string | null,
): Promise<boolean> {
  const env = envOverride(name);
  if (env !== null) return env;

  const rows = await query<FeatureFlagRow>(
    "SELECT name, enabled_globally, enabled_workspaces FROM feature_flags WHERE name = $1",
    [name],
  );
  const row = rows[0];
  if (!row) return false;
  if (row.enabled_globally) return true;
  if (workspaceId && row.enabled_workspaces.includes(workspaceId)) return true;
  return false;
}

/** Admin helper: turn a flag on/off globally, or scope it to a workspace list. */
export async function setFlag(
  name: FlagName,
  opts: { enabledGlobally?: boolean; enabledWorkspaces?: string[] },
): Promise<void> {
  await query(
    `INSERT INTO feature_flags (name, enabled_globally, enabled_workspaces)
     VALUES ($1, $2, $3)
     ON CONFLICT (name) DO UPDATE
       SET enabled_globally = EXCLUDED.enabled_globally,
           enabled_workspaces = EXCLUDED.enabled_workspaces,
           updated_at = now()`,
    [name, opts.enabledGlobally ?? false, opts.enabledWorkspaces ?? []],
  );
}
