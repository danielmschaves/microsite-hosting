import { randomUUID } from "crypto";
import { BASE_URL } from "./config.js";
import { getCachedToken, AuthRequiredError } from "./auth.js";

export class MicroBuildApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "MicroBuildApiError";
  }
}

/**
 * Thin HTTP bridge from an MCP tool call to app/api/agent/**. Every 14 R1
 * tools go through this — no tool talks to fetch() directly, so auth
 * failures / typed errors are handled in exactly one place (PRD v2.0's
 * "insufficient_scope naming the scope" requirement surfaces here as a
 * MicroBuildApiError the tool handler can format for the model).
 */
export async function apiCall(
  method: string,
  path: string,
  opts: { body?: unknown; idempotent?: boolean } = {},
): Promise<unknown> {
  const token = await getCachedToken();
  if (!token) {
    throw new AuthRequiredError(`${BASE_URL}/oauth/device`);
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  if (opts.idempotent) {
    headers["Idempotency-Key"] = randomUUID();
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const code = typeof data.error === "string" ? data.error : "unknown_error";
    const message = typeof data.message === "string" ? data.message : `Request failed (${res.status})`;
    throw new MicroBuildApiError(code, message, res.status, data);
  }
  return data;
}
