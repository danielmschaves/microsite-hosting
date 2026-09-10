import { NextResponse } from "next/server";
import { authorizeSiteManage } from "@/lib/authz";
import { rollbackToVersion } from "@/lib/siteMutations";

export const runtime = "nodejs";

// POST { version } — instant rollback: flip the sites row to an older
// version's prefix/index. No bytes move; the retained version's files are
// still in storage (pruning never deletes the live prefix). Logic lives in
// lib/siteMutations.ts's rollbackToVersion, shared with the agent
// `rollback_to_version` tool.
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

  const result = await rollbackToVersion(site, email, version);
  return NextResponse.json(result.body, { status: result.status });
}
