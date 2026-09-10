import type { WorkspaceRow } from "./db";
import { TTL_PRESETS, type TtlPreset } from "./ttl";

// ---------------------------------------------------------------------------
// Plan model (PRD §7). Free is the default everywhere; the Team plan is
// carried by a workspace with an active Stripe subscription. Gates apply to
// NEW operations only — existing sites are grandfathered and keep serving.
// ---------------------------------------------------------------------------

export interface PlanLimits {
  id: "free" | "team";
  /** Active-site cap: per user (free) / per workspace (team). */
  siteLimit: number;
  /** Max size of a single site (all pages combined). */
  maxSiteBytes: number;
  /** Longest TTL preset this plan may pick. */
  maxTtl: TtlPreset;
  /** Audit log window in days (0 = no audit access). */
  auditDays: number;
  /** Retained versions per site (1 = plain overwrite, no history). */
  versionLimit: number;
  /** Visitor insights access (PRD §10: — on free, ✓ on team+). */
  insightsEnabled: boolean;
}

export const FREE_PLAN: PlanLimits = {
  id: "free",
  siteLimit: 5,
  maxSiteBytes: 25 * 1024 * 1024,
  maxTtl: "7d",
  auditDays: 0,
  versionLimit: 1,
  insightsEnabled: false,
};

export const TEAM_PLAN: PlanLimits = {
  id: "team",
  siteLimit: 100,
  maxSiteBytes: 250 * 1024 * 1024,
  maxTtl: "90d",
  auditDays: 30,
  versionLimit: 5,
  insightsEnabled: true,
};

// Legacy exports (AppBar meter + trash window) — keep stable.
export const FREE_SITE_LIMIT = FREE_PLAN.siteLimit;
export const FREE_STORAGE_BYTES = FREE_PLAN.maxSiteBytes;
export const TRASH_DAYS = 7;

export const MIN_TEAM_SEATS = 3;

/** Stripe configured? Absent keys = billing UI degrades, everything is free. */
export const billingEnabled = Boolean(
  process.env.STRIPE_SECRET_KEY && process.env.STRIPE_TEAM_PRICE_ID,
);

/**
 * Dev-only override: treat every workspace as Team without Stripe. Blocked on
 * Vercel production (same safety pattern as AUTH_DEV_LOGIN).
 */
export const fakeTeam =
  process.env.PLAN_FAKE_TEAM === "true" &&
  process.env.VERCEL_ENV !== "production";

const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

/** Effective plan for a workspace (null = personal context = free). */
export function planForWorkspace(ws: WorkspaceRow | null): PlanLimits {
  if (!ws) return FREE_PLAN;
  if (fakeTeam) return TEAM_PLAN;
  if (ws.plan === "team" && ACTIVE_STATUSES.has(ws.subscription_status || "")) {
    return TEAM_PLAN;
  }
  return FREE_PLAN;
}

const PRESET_ORDER: TtlPreset[] = ["24h", "7d", "30d", "90d"];

/**
 * TTL presets a site in this context may use: capped by the plan max and by
 * the workspace's max-TTL policy (§6.3), whichever is stricter.
 */
export function allowedTtlPresets(
  plan: PlanLimits,
  wsPolicy: string | null = null,
): TtlPreset[] {
  const planCap = TTL_PRESETS[plan.maxTtl];
  const policyCap =
    wsPolicy && wsPolicy in TTL_PRESETS
      ? TTL_PRESETS[wsPolicy as TtlPreset]
      : Infinity;
  const cap = Math.min(planCap, policyCap);
  return PRESET_ORDER.filter((p) => TTL_PRESETS[p] <= cap);
}
