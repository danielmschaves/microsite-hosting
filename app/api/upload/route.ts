import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { query, type SiteRow, type WorkspaceRow } from "@/lib/db";
import { putObject } from "@/lib/storage";
import { generateSlug, normalizeSlug } from "@/lib/slug";
import { expiresAtFrom, isTtlPreset } from "@/lib/ttl";
import { getMembership } from "@/lib/teams";
import { isVisibility, type Visibility } from "@/lib/authz";
import { planForWorkspace, allowedTtlPresets, fakeTeam } from "@/lib/plan";
import { track } from "@/lib/events";

export const runtime = "nodejs";

// Extra body cap for this multipart route only (Vercel functions cap ~4.5MB
// anyway; pre-signed uploads are the large-file path).
const MAX_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 262_144_000);
const MAX_PAGES = 20;

/**
 * Make a stored filename safe: strip any path components, keep a conservative
 * character set, and require a .html extension. Returns null if unusable.
 */
function sanitizeFilename(name: string): string | null {
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

export async function POST(req: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const form = await req.formData();
  const rawFiles = form.getAll("file").filter((f): f is File => f instanceof File);
  const ttl = String(form.get("ttl") || "");
  const requestedSlug = String(form.get("slug") || "").trim();
  const requestedIndex = String(form.get("index") || "").trim();
  const viewersRaw = String(form.get("viewers") || "");
  const workspaceId = String(form.get("workspaceId") || "").trim() || null;
  const visibilityRaw = String(form.get("visibility") || "allowlist");

  if (rawFiles.length === 0) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  // Destination + visibility validation.
  if (!isVisibility(visibilityRaw)) {
    return NextResponse.json(
      { error: "visibility must be only_me, allowlist or team" },
      { status: 400 },
    );
  }
  const visibility: Visibility = visibilityRaw;
  let workspace: WorkspaceRow | null = null;
  if (workspaceId) {
    const membership = await getMembership(email, workspaceId).catch(() => null);
    if (!membership) {
      return NextResponse.json(
        { error: "You are not a member of that workspace" },
        { status: 403 },
      );
    }
    workspace =
      (
        await query<WorkspaceRow>("SELECT * FROM workspaces WHERE id = $1", [
          workspaceId,
        ])
      )[0] ?? null;
  }
  if (visibility === "team" && !workspaceId) {
    return NextResponse.json(
      { error: "Team visibility requires a workspace destination" },
      { status: 400 },
    );
  }

  // ---- plan gates (PRD §7) — apply to new uploads only ---------------------
  const plan = planForWorkspace(workspace);
  if (visibility === "team" && plan.id !== "team") {
    return NextResponse.json(
      {
        error: "Team visibility requires the Team plan",
        upgradeUrl: `/teams/${workspaceId}`,
      },
      { status: 402 },
    );
  }
  const allowedTtls = allowedTtlPresets(plan, workspace?.max_ttl_preset ?? null);
  if (!isTtlPreset(ttl) || !allowedTtls.includes(ttl)) {
    return NextResponse.json(
      {
        error: `ttl must be one of ${allowedTtls.join(", ")} on this plan`,
        ...(plan.id === "free" ? { upgradeUrl: workspaceId ? `/teams/${workspaceId}` : "/teams" } : {}),
      },
      { status: isTtlPreset(ttl) ? 402 : 400 },
    );
  }
  // Site-count gate: team workspaces count their own sites; free contexts
  // count the owner's live sites outside team-plan workspaces.
  if (plan.id === "team" && workspaceId) {
    const wsCount = await query<{ count: string }>(
      "SELECT count(*) FROM sites WHERE workspace_id = $1 AND deleted_at IS NULL",
      [workspaceId],
    );
    if (Number(wsCount[0].count) >= plan.siteLimit) {
      return NextResponse.json(
        { error: `Workspace limit of ${plan.siteLimit} active sites reached` },
        { status: 402 },
      );
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
      return NextResponse.json(
        {
          error: `Free plan limit of ${plan.siteLimit} active sites reached — delete one or upgrade a workspace`,
          upgradeUrl: "/teams",
        },
        { status: 402 },
      );
    }
  }
  if (rawFiles.length > MAX_PAGES) {
    return NextResponse.json(
      { error: `At most ${MAX_PAGES} pages per site` },
      { status: 400 },
    );
  }
  // (TTL validity + plan cap already enforced above.)

  // Validate + sanitize every file (single self-contained .html pages only).
  const files: { name: string; file: File }[] = [];
  const seen = new Set<string>();
  let totalBytes = 0;
  for (const f of rawFiles) {
    const isHtml = f.type === "text/html" || /\.html?$/i.test(f.name);
    if (!isHtml) {
      return NextResponse.json(
        { error: `"${f.name}": only .html files are accepted` },
        { status: 400 },
      );
    }
    const name = sanitizeFilename(f.name);
    if (!name) {
      return NextResponse.json(
        { error: `"${f.name}": unusable filename` },
        { status: 400 },
      );
    }
    if (seen.has(name)) {
      return NextResponse.json(
        { error: `Duplicate filename after sanitizing: ${name}` },
        { status: 400 },
      );
    }
    seen.add(name);
    totalBytes += f.size;
    files.push({ name, file: f });
  }
  const sizeCap = Math.min(plan.maxSiteBytes, MAX_BYTES);
  if (totalBytes > sizeCap) {
    return NextResponse.json(
      {
        error: `Files exceed the ${(sizeCap / (1024 * 1024)).toFixed(0)} MB site limit${plan.id === "free" ? " (Team plan allows 250 MB)" : ""}`,
      },
      { status: 413 },
    );
  }

  // Resolve the index page: explicit choice, single file, or index.html.
  let indexName: string;
  if (requestedIndex) {
    const match = sanitizeFilename(requestedIndex);
    if (!match || !seen.has(match)) {
      return NextResponse.json(
        { error: "index must name one of the uploaded files" },
        { status: 400 },
      );
    }
    indexName = match;
  } else if (files.length === 1) {
    indexName = files[0].name;
  } else {
    const auto = files.find((f) => f.name.toLowerCase() === "index.html");
    if (!auto) {
      return NextResponse.json(
        { error: "Multiple files: include an index.html or mark one as index" },
        { status: 400 },
      );
    }
    indexName = auto.name;
  }

  // Resolve slug: use the requested one (validated) or generate a unique one.
  let slug: string | null;
  if (requestedSlug) {
    slug = normalizeSlug(requestedSlug);
    if (!slug) {
      return NextResponse.json(
        { error: "Invalid slug (use 3-63 lowercase letters, numbers, dashes)" },
        { status: 400 },
      );
    }
    const existing = await query<SiteRow>(
      "SELECT id FROM sites WHERE slug = $1 AND deleted_at IS NULL",
      [slug],
    );
    if (existing.length > 0) {
      return NextResponse.json({ error: "Slug already taken" }, { status: 409 });
    }
  } else {
    slug = await uniqueSlug();
  }

  const s3Prefix = `sites/${slug}-${Date.now().toString(36)}/`;
  for (const { name, file } of files) {
    const buffer = Buffer.from(await file.arrayBuffer());
    await putObject(`${s3Prefix}${name}`, buffer, "text/html; charset=utf-8");
  }
  const indexKey = `${s3Prefix}${indexName}`;

  const expiresAt = expiresAtFrom(ttl);
  const inserted = await query<SiteRow>(
    `INSERT INTO sites
       (slug, owner_email, s3_prefix, index_key, content_type, size_bytes, page_count, ttl_preset, expires_at, workspace_id, visibility)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [slug, email, s3Prefix, indexKey, "text/html", totalBytes, files.length, ttl, expiresAt, workspaceId, visibility],
  );
  const site = inserted[0];

  // Owner always has access; add any additional allowlisted viewer emails.
  const viewers = parseEmails(viewersRaw);
  for (const viewer of viewers) {
    await query(
      `INSERT INTO site_viewers (site_id, viewer_email)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [site.id, viewer],
    );
  }

  await track("site_created", {
    siteId: site.id,
    workspaceId: workspaceId ?? undefined,
    actor: email,
    meta: { pages: files.length, ttl, bytes: totalBytes, viewers: viewers.length, visibility },
  });

  const base = process.env.NEXT_PUBLIC_BASE_URL || new URL(req.url).origin;
  return NextResponse.json({
    slug,
    url: `${base}/s/${slug}`,
    pages: files.length,
    expiresAt: expiresAt.toISOString(),
  });
}

async function uniqueSlug(): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const candidate = generateSlug();
    const existing = await query(
      "SELECT 1 FROM sites WHERE slug = $1 AND deleted_at IS NULL",
      [candidate],
    );
    if (existing.length === 0) return candidate;
  }
  // Extremely unlikely fallback.
  return `${generateSlug()}-${Date.now().toString(36)}`;
}

function parseEmails(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(/[\s,;]+/)
        .map((e) => e.trim().toLowerCase())
        .filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)),
    ),
  );
}
