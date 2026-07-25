import { NextResponse } from "next/server";
import { query, type SiteRow, type WorkspaceRow } from "./db";
import { generateSlug, normalizeSlug } from "./slug";
import { expiresAtFrom, isTtlPreset, type TtlPreset } from "./ttl";
import { getMembership } from "./teams";
import { isVisibility, type Visibility } from "./authz";
import { planForWorkspace, allowedTtlPresets, fakeTeam, type PlanLimits } from "./plan";
import { track } from "./events";

// Shared machinery for both upload paths (multipart fallback and presigned
// browser->S3). Validation runs before any bytes move; createSiteRecord runs
// after the files are in storage.

export const MAX_PAGES = 20;
const EMAIL_LIST_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Path-safe stored filename, or null if unusable. */
export function sanitizeFilename(name: string): string | null {
  const base = name.split(/[\\/]/).pop() || "";
  const cleaned = base
    .trim()
    .replace(/[^a-zA-Z0-9._ -]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+/, "");
  if (!/\.html?$/i.test(cleaned)) return null;
  if (cleaned.length < 6 || cleaned.length > 128) return null; // "a.html" = 6
  return cleaned;
}

export function parseEmails(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(/[\s,;]+/)
        .map((e) => e.trim().toLowerCase())
        .filter((e) => EMAIL_LIST_RE.test(e)),
    ),
  );
}

export interface ValidatedUpload {
  workspace: WorkspaceRow | null;
  workspaceId: string | null;
  visibility: Visibility;
  plan: PlanLimits;
  ttl: TtlPreset;
}

/**
 * Destination, visibility, plan, TTL and site-count gates (PRD §7). Returns
 * an error response or the resolved context. Size checks happen separately —
 * declared sizes at presign time, S3-reported truth at completion.
 */
export async function validateUploadRequest(opts: {
  email: string;
  ttl: string;
  workspaceId: string | null;
  visibilityRaw: string;
}): Promise<{ error: NextResponse } | ValidatedUpload> {
  const { email, ttl, workspaceId } = opts;

  if (!isVisibility(opts.visibilityRaw)) {
    return {
      error: NextResponse.json(
        { error: "visibility must be only_me, allowlist or team" },
        { status: 400 },
      ),
    };
  }
  const visibility = opts.visibilityRaw;

  let workspace: WorkspaceRow | null = null;
  if (workspaceId) {
    const membership = await getMembership(email, workspaceId).catch(() => null);
    if (!membership) {
      return {
        error: NextResponse.json(
          { error: "You are not a member of that workspace" },
          { status: 403 },
        ),
      };
    }
    workspace =
      (
        await query<WorkspaceRow>("SELECT * FROM workspaces WHERE id = $1", [
          workspaceId,
        ])
      )[0] ?? null;
  }
  if (visibility === "team" && !workspaceId) {
    return {
      error: NextResponse.json(
        { error: "Team visibility requires a workspace destination" },
        { status: 400 },
      ),
    };
  }

  const plan = planForWorkspace(workspace);
  if (visibility === "team" && plan.id !== "team") {
    return {
      error: NextResponse.json(
        { error: "Team visibility requires the Team plan", upgradeUrl: `/teams/${workspaceId}` },
        { status: 402 },
      ),
    };
  }

  const allowedTtls = allowedTtlPresets(plan, workspace?.max_ttl_preset ?? null);
  if (!isTtlPreset(ttl) || !allowedTtls.includes(ttl)) {
    return {
      error: NextResponse.json(
        {
          error: `ttl must be one of ${allowedTtls.join(", ")} on this plan`,
          ...(plan.id === "free"
            ? { upgradeUrl: workspaceId ? `/teams/${workspaceId}` : "/teams" }
            : {}),
        },
        { status: isTtlPreset(ttl) ? 402 : 400 },
      ),
    };
  }

  // Site-count gate: team workspaces count their own sites; free contexts
  // count the owner's live sites outside team-plan workspaces.
  if (plan.id === "team" && workspaceId) {
    const wsCount = await query<{ count: string }>(
      "SELECT count(*) FROM sites WHERE workspace_id = $1 AND deleted_at IS NULL",
      [workspaceId],
    );
    if (Number(wsCount[0].count) >= plan.siteLimit) {
      return {
        error: NextResponse.json(
          { error: `Workspace limit of ${plan.siteLimit} active sites reached` },
          { status: 402 },
        ),
      };
    }
  } else {
    const freeCount = await query<{ count: string }>(
      `SELECT count(*) FROM sites s
        LEFT JOIN workspaces w ON w.id = s.workspace_id
        WHERE s.owner_email = $1 AND s.deleted_at IS NULL
          AND (s.workspace_id IS NULL OR ${fakeTeam ? "false" : "w.plan <> 'team'"})`,
      [email],
    );
    if (Number(freeCount[0].count) >= plan.siteLimit) {
      return {
        error: NextResponse.json(
          {
            error: `Free plan limit of ${plan.siteLimit} active sites reached — delete one or upgrade a workspace`,
            upgradeUrl: "/teams",
          },
          { status: 402 },
        ),
      };
    }
  }

  return { workspace, workspaceId, visibility, plan, ttl };
}

/** Resolve which uploaded file is the index page. */
export function resolveIndex(
  names: string[],
  requestedIndex: string,
): { indexName: string } | { error: string } {
  if (requestedIndex) {
    const match = sanitizeFilename(requestedIndex);
    if (!match || !names.includes(match)) {
      return { error: "index must name one of the uploaded files" };
    }
    return { indexName: match };
  }
  if (names.length === 1) return { indexName: names[0] };
  const auto = names.find((n) => n.toLowerCase() === "index.html");
  if (!auto) {
    return { error: "Multiple files: include an index.html or mark one as index" };
  }
  return { indexName: auto };
}

/** Validate a requested slug or generate a unique one. */
export async function resolveSlug(
  requestedSlug: string,
): Promise<{ slug: string } | { error: string; status: number }> {
  if (requestedSlug) {
    const slug = normalizeSlug(requestedSlug);
    if (!slug) {
      return {
        error: "Invalid slug (use 3-63 lowercase letters, numbers, dashes)",
        status: 400,
      };
    }
    const existing = await query(
      "SELECT 1 FROM sites WHERE slug = $1 AND deleted_at IS NULL",
      [slug],
    );
    if (existing.length > 0) return { error: "Slug already taken", status: 409 };
    return { slug };
  }
  for (let i = 0; i < 8; i++) {
    const candidate = generateSlug();
    const existing = await query(
      "SELECT 1 FROM sites WHERE slug = $1 AND deleted_at IS NULL",
      [candidate],
    );
    if (existing.length === 0) return { slug: candidate };
  }
  return { slug: `${generateSlug()}-${Date.now().toString(36)}` };
}

/** Insert the site row + viewers + analytics after files are in storage. */
export async function createSiteRecord(opts: {
  email: string;
  slug: string;
  s3Prefix: string;
  indexName: string;
  totalBytes: number;
  pageCount: number;
  ttl: TtlPreset;
  workspaceId: string | null;
  visibility: Visibility;
  viewers: string[];
}): Promise<SiteRow> {
  const expiresAt = expiresAtFrom(opts.ttl);
  const inserted = await query<SiteRow>(
    `INSERT INTO sites
       (slug, owner_email, s3_prefix, index_key, content_type, size_bytes, page_count, ttl_preset, expires_at, workspace_id, visibility)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      opts.slug,
      opts.email,
      opts.s3Prefix,
      `${opts.s3Prefix}${opts.indexName}`,
      "text/html",
      opts.totalBytes,
      opts.pageCount,
      opts.ttl,
      expiresAt,
      opts.workspaceId,
      opts.visibility,
    ],
  );
  const site = inserted[0];

  const viewers = opts.visibility === "allowlist" ? opts.viewers : [];
  for (const viewer of viewers) {
    await query(
      `INSERT INTO site_viewers (site_id, viewer_email)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [site.id, viewer],
    );
  }

  await track("site_created", {
    siteId: site.id,
    workspaceId: opts.workspaceId ?? undefined,
    actor: opts.email,
    meta: {
      pages: opts.pageCount,
      ttl: opts.ttl,
      bytes: opts.totalBytes,
      viewers: viewers.length,
      visibility: opts.visibility,
    },
  });

  return site;
}
