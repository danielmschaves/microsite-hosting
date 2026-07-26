import { NextResponse } from "next/server";
import { query, type SiteVersionRow } from "@/lib/db";
import { authorizeSiteManage } from "@/lib/authz";
import { track } from "@/lib/events";

export const runtime = "nodejs";

// POST { version } — instant rollback: flip the sites row to an older
// version's prefix/index. No bytes move; the retained version's files are
// still in storage (pruning never deletes the live prefix).
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const res = await authorizeSiteManage(id);
  if ("error" in res) return res.error;
  const { site, email } = res;

  const body = await req.json().catch(() => ({}));
  const version = Number(body?.version);
  if (!Number.isInteger(version) || version < 1) {
    return NextResponse.json({ error: "Provide { version }" }, { status: 400 });
  }
  if (version === site.current_version) {
    return NextResponse.json({ error: "Already the current version" }, { status: 400 });
  }

  const rows = await query<SiteVersionRow>(
    "SELECT * FROM site_versions WHERE site_id = $1 AND version = $2",
    [id, version],
  );
  const target = rows[0];
  if (!target) {
    return NextResponse.json(
      { error: "Version not found (older versions are pruned)" },
      { status: 404 },
    );
  }

  await query(
    `UPDATE sites
        SET s3_prefix = $1, index_key = $2, size_bytes = $3, page_count = $4,
            current_version = $5
      WHERE id = $6`,
    [
      target.s3_prefix,
      target.index_key,
      target.size_bytes,
      target.page_count,
      target.version,
      id,
    ],
  );

  await track("site_rolled_back", {
    siteId: id,
    workspaceId: site.workspace_id ?? undefined,
    actor: email,
    meta: { from: site.current_version, to: version },
  });

  return NextResponse.json({ ok: true, version });
}
