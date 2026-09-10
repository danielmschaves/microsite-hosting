import { NextResponse } from "next/server";

// Typed error shape for app/api/agent/** — a structured superset of the
// existing {error} convention used everywhere else in the app ({error,
// message, ...extra}), still backward-compatible (every response still has
// .error). See CLAUDE.md's Agent Gateway section for the full code list.

export function agentError(
  code: string,
  message: string,
  status: number,
  extra: Record<string, unknown> = {},
): NextResponse {
  return NextResponse.json({ error: code, message, ...extra }, { status });
}

export const notFound = (message = "Not found") => agentError("not_found", message, 404);
export const badRequest = (message: string) => agentError("invalid_request", message, 400);
