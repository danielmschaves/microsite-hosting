import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createToken, listTokens } from "@/lib/apiTokens";

export const runtime = "nodejs";

// Token CRUD is session-authenticated only — tokens cannot mint tokens.

export async function GET() {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ tokens: await listTokens(email) });
}

export async function POST(req: Request) {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const name = String(body?.name || "").trim().slice(0, 80) || "API token";

  const { secret, token } = await createToken(email, name);
  // The secret exists only in this response — it is never retrievable again.
  return NextResponse.json({ secret, token }, { status: 201 });
}
