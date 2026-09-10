import { homedir } from "os";
import { join } from "path";

export const BASE_URL = process.env.MICROBUILD_BASE_URL || "https://microsite-hosting.vercel.app";
export const CREDENTIALS_PATH =
  process.env.MICROBUILD_CREDENTIALS_PATH || join(homedir(), ".microbuild", "credentials.json");
export const SITE_MAP_PATH = ".microbuild/site.json";

export type ClientKind = "claude-code" | "codex" | "cursor" | "other";

export function detectClientKind(target: string): ClientKind {
  const t = target.toLowerCase();
  if (t === "claude-code" || t === "codex" || t === "cursor") return t;
  return "other";
}

// The 14 R1 scopes this MCP server's tools need. Requested in full at
// install time — see PRD v2.0 §9.1; the consent screen shows exactly these,
// in plain language, before anything is granted.
export const REQUESTED_SCOPES = [
  "project:read",
  "site:read",
  "site:write",
  "site:delete",
  "preview:create",
  "preview:read",
  "publish:confirm",
  "rollback:confirm",
] as const;
