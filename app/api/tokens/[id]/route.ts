import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { revokeToken } from "@/lib/apiTokens";

export const runtime = "nodejs";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ok = await revokeToken(id, email);
  if (!ok) return NextResponse.json({ error: "Token not found" }, { status: 404 });
  return NextResponse.json({ ok: true, revoked: true });
}
