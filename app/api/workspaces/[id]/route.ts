import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireWorkspaceRole } from "@/lib/teams";
import { isTtlPreset } from "@/lib/ttl";
import { track } from "@/lib/events";

export const runtime = "nodejs";

// PATCH — admin+: { name } rename or { maxTtl: preset|null } TTL policy.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const res = await requireWorkspaceRole(id, "admin");
  if ("error" in res) return res.error;
  const { email } = res;

  const body = await req.json().catch(() => ({}));

  if (typeof body?.name === "string") {
    const name = body.name.trim();
    if (name.length < 2 || name.length > 80) {
      return NextResponse.json(
        { error: "Workspace name must be 2-80 characters" },
        { status: 400 },
      );
    }
    await query("UPDATE workspaces SET name = $1 WHERE id = $2", [name, id]);
    await track("workspace_renamed", { workspaceId: id, actor: email, meta: { name } });
    return NextResponse.json({ ok: true, name });
  }

  if ("maxTtl" in (body ?? {})) {
    const maxTtl = body.maxTtl === null ? null : String(body.maxTtl);
    if (maxTtl !== null && !isTtlPreset(maxTtl)) {
      return NextResponse.json(
        { error: "maxTtl must be a TTL preset or null" },
        { status: 400 },
      );
    }
    await query("UPDATE workspaces SET max_ttl_preset = $1 WHERE id = $2", [
      maxTtl,
      id,
    ]);
    await track("ttl_policy_changed", {
      workspaceId: id,
      actor: email,
      meta: { maxTtl },
    });
    return NextResponse.json({ ok: true, maxTtl });
  }

  return NextResponse.json(
    { error: "Provide { name } or { maxTtl }" },
    { status: 400 },
  );
}
