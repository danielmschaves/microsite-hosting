import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname } from "path";
import { BASE_URL, CREDENTIALS_PATH, REQUESTED_SCOPES, type ClientKind } from "./config.js";

interface StoredCredentials {
  accessToken: string;
  expiresAt: number; // epoch ms
  scope: string;
}

/** The typed `auth_required` error the PRD specifies — synthesized locally, no server round-trip. */
export class AuthRequiredError extends Error {
  constructor(public authorizationUrl?: string) {
    super("auth_required: this MicroBuild agent is not yet authorized. Run the install/auth flow.");
    this.name = "AuthRequiredError";
  }
}

async function readCredentials(): Promise<StoredCredentials | null> {
  try {
    const raw = await readFile(CREDENTIALS_PATH, "utf8");
    return JSON.parse(raw) as StoredCredentials;
  } catch {
    return null;
  }
}

async function writeCredentials(creds: StoredCredentials): Promise<void> {
  await mkdir(dirname(CREDENTIALS_PATH), { recursive: true });
  await writeFile(CREDENTIALS_PATH, JSON.stringify(creds, null, 2), { mode: 0o600 });
}

/** Cached, valid access token — or null if none exists / it has expired. */
export async function getCachedToken(): Promise<string | null> {
  const creds = await readCredentials();
  if (!creds) return null;
  if (Date.now() >= creds.expiresAt) return null;
  return creds.accessToken;
}

/**
 * Device-code bootstrap (PRD v2.0 CD-07/CD-08): request a device+user code,
 * print the verification URL for the human, poll /api/oauth/token until
 * authorized, cache the resulting token. Used both by `install --to` (to
 * validate the connection up front) and lazily by the first tool call that
 * finds no cached credential.
 */
export async function authorize(clientName: string, clientKind: ClientKind): Promise<string> {
  const deviceRes = await fetch(`${BASE_URL}/api/oauth/device`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: clientName,
      client_kind: clientKind,
      scopes: REQUESTED_SCOPES.join(","),
    }),
  });
  if (!deviceRes.ok) {
    throw new Error(`Could not start authorization (${deviceRes.status}): ${await deviceRes.text()}`);
  }
  const device = (await deviceRes.json()) as {
    device_code: string;
    user_code: string;
    verification_uri_complete: string;
    verification_uri: string;
    expires_in: number;
    interval: number;
  };

  process.stderr.write(
    `\nMicroBuild: open ${device.verification_uri_complete} to authorize this agent (code ${device.user_code}).\n`,
  );

  const deadline = Date.now() + device.expires_in * 1000;
  const intervalMs = Math.max(1000, device.interval * 1000);
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, intervalMs));
    const tokenRes = await fetch(`${BASE_URL}/api/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: device.device_code,
      }),
    });
    const body = (await tokenRes.json().catch(() => ({}))) as Record<string, unknown>;
    if (tokenRes.ok && typeof body.access_token === "string") {
      const expiresIn = typeof body.expires_in === "number" ? body.expires_in : 90 * 24 * 60 * 60;
      await writeCredentials({
        accessToken: body.access_token,
        expiresAt: Date.now() + expiresIn * 1000,
        scope: typeof body.scope === "string" ? body.scope : "",
      });
      process.stderr.write("MicroBuild: authorized.\n");
      return body.access_token;
    }
    if (body.error === "authorization_pending") continue;
    throw new Error(`Authorization failed: ${body.error || tokenRes.status}`);
  }
  throw new Error("Authorization timed out — run the install command again.");
}

/** Get a valid token, authorizing (device-code flow) if none is cached. */
export async function ensureAuthorized(clientName: string, clientKind: ClientKind): Promise<string> {
  const cached = await getCachedToken();
  if (cached) return cached;
  return authorize(clientName, clientKind);
}
