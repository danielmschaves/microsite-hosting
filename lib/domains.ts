import { randomBytes } from "crypto";
import { promises as dns } from "dns";
import {
  query,
  withTransaction,
  type SiteDomainRow,
  type DnsRecord,
  type DomainStatus,
  type CertStatus,
} from "./db";
import { track } from "./events";

// ---------------------------------------------------------------------------
// Custom domains (PRD v2.0 CD-21). Real, general-purpose "point your own
// domain at us" — every hosting product does this with a CNAME + a TXT
// ownership challenge, and none of it depends on this deployment owning any
// particular apex domain itself. Certificate issuance (CD-22, ACME) is a
// separate, later release; this module only ever writes cert_status
// 'none'/'issuing'/'failed' as bookkeeping, never actually provisions one.
// ---------------------------------------------------------------------------

export const MAX_DOMAINS_PER_SITE = 5;

// Deliberately permissive (RFC 1123-ish, case-insensitive, dots required) —
// this validates shape, not DNS-existence; verifyCustomDomain is what
// actually proves the caller controls it.
const HOSTNAME_RE = /^(?=.{4,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-)){1,}$/;

export function normalizeHostname(input: string): string | null {
  const cleaned = input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "");
  if (!HOSTNAME_RE.test(cleaned)) return null;
  return cleaned;
}

/** Crude but sufficient for "which record type do we recommend" messaging — not authoritative DNS logic. */
function isApex(hostname: string): boolean {
  return hostname.split(".").length === 2;
}

/** The hostname operators should CNAME (or ALIAS/ANAME at the apex) their domain to. */
export function cnameTarget(): string {
  const base = process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXTAUTH_URL || "";
  try {
    return new URL(base).hostname;
  } catch {
    return "localhost";
  }
}

function challengeRecordName(hostname: string): string {
  return `_microbuild-challenge.${hostname}`;
}

export function buildDnsRecords(hostname: string, verificationToken: string): DnsRecord[] {
  const target = cnameTarget();
  const records: DnsRecord[] = [];
  if (isApex(hostname)) {
    records.push({
      type: "ALIAS/ANAME",
      name: "@",
      value: target,
      note: "Apex domains can't use a CNAME per the DNS spec — use your provider's ALIAS, ANAME, or flattened-CNAME record type pointed at this value.",
    });
  } else {
    records.push({ type: "CNAME", name: hostname, value: target });
  }
  records.push({
    type: "TXT",
    name: challengeRecordName(hostname),
    value: verificationToken,
    note: "Proves you control this domain. Safe to remove once status is verified.",
  });
  return records;
}

function generateVerificationToken(): string {
  return randomBytes(16).toString("hex");
}

export type AddDomainOutcome =
  | { ok: true; domain: SiteDomainRow }
  | { ok: false; error: string; status: number };

export async function addCustomDomain(opts: {
  siteId: string;
  hostname: string;
  createdBy: string;
}): Promise<AddDomainOutcome> {
  const hostname = normalizeHostname(opts.hostname);
  if (!hostname) {
    return { ok: false, error: "Invalid hostname", status: 400 };
  }

  const countRows = await query<{ count: string }>(
    "SELECT count(*) FROM site_domains WHERE site_id = $1",
    [opts.siteId],
  );
  if (Number(countRows[0].count) >= MAX_DOMAINS_PER_SITE) {
    return {
      ok: false,
      error: `Maximum of ${MAX_DOMAINS_PER_SITE} domains per site`,
      status: 402,
    };
  }

  const taken = await query("SELECT 1 FROM site_domains WHERE hostname = $1", [hostname]);
  if (taken.length > 0) {
    return { ok: false, error: "This domain is already in use", status: 409 };
  }

  const verificationToken = generateVerificationToken();
  const dnsRecords = buildDnsRecords(hostname, verificationToken);

  const inserted = await query<SiteDomainRow>(
    `INSERT INTO site_domains (site_id, hostname, verification_token, dns_records, created_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [opts.siteId, hostname, verificationToken, JSON.stringify(dnsRecords), opts.createdBy],
  );
  const domain = inserted[0];

  await track("domain_added", { siteId: opts.siteId, actor: opts.createdBy, meta: { hostname } });

  return { ok: true, domain };
}

export async function listSiteDomains(siteId: string): Promise<SiteDomainRow[]> {
  return query<SiteDomainRow>(
    "SELECT * FROM site_domains WHERE site_id = $1 ORDER BY created_at ASC",
    [siteId],
  );
}

export async function getSiteDomain(id: string, siteId: string): Promise<SiteDomainRow | null> {
  const rows = await query<SiteDomainRow>(
    "SELECT * FROM site_domains WHERE id = $1 AND site_id = $2",
    [id, siteId],
  ).catch(() => [] as SiteDomainRow[]);
  return rows[0] ?? null;
}

export async function removeDomain(id: string, siteId: string, actor: string): Promise<boolean> {
  const rows = await query<SiteDomainRow>(
    "DELETE FROM site_domains WHERE id = $1 AND site_id = $2 RETURNING *",
    [id, siteId],
  );
  const removed = rows[0];
  if (!removed) return false;
  if (removed.is_primary) {
    await query("UPDATE sites SET primary_host = NULL WHERE id = $1", [siteId]);
  }
  await track("domain_removed", { siteId, actor, meta: { hostname: removed.hostname } });
  return true;
}

export type VerifyDomainOutcome =
  | { ok: true; domain: SiteDomainRow }
  | { ok: false; error: string; status: number };

/**
 * Re-check DNS for a domain: the TXT challenge record must carry the exact
 * verification token. Idempotent — an already-verified domain short-circuits
 * to true without a fresh lookup, so callers can poll this freely.
 */
export async function verifyCustomDomain(
  id: string,
  siteId: string,
  actor: string,
): Promise<VerifyDomainOutcome> {
  const domain = await getSiteDomain(id, siteId);
  if (!domain) return { ok: false, error: "Domain not found", status: 404 };
  if (domain.status === "verified") return { ok: true, domain };

  let found = false;
  try {
    const records = await dns.resolveTxt(challengeRecordName(domain.hostname));
    found = records.some((chunks) => chunks.join("").trim() === domain.verification_token);
  } catch {
    found = false; // NXDOMAIN, timeout, no TXT record yet — all "not verified", not an error to the caller
  }

  if (!found) {
    await query("UPDATE site_domains SET status = 'failed' WHERE id = $1", [domain.id]);
    await track("domain_verification_failed", {
      siteId,
      actor,
      meta: { hostname: domain.hostname },
    });
    return {
      ok: false,
      error: "TXT record not found or does not match yet — DNS changes can take a few minutes to propagate",
      status: 409,
    };
  }

  const updated = await query<SiteDomainRow>(
    "UPDATE site_domains SET status = 'verified', verified_at = now() WHERE id = $1 RETURNING *",
    [domain.id],
  );
  await track("domain_verified", { siteId, actor, meta: { hostname: domain.hostname } });
  return { ok: true, domain: updated[0] };
}

/** Mark one verified domain as the site's primary; clears the previous primary, if any. */
export async function setPrimaryDomain(
  id: string,
  siteId: string,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const domain = await getSiteDomain(id, siteId);
  if (!domain) return { ok: false, error: "Domain not found", status: 404 };
  if (domain.status !== "verified") {
    return { ok: false, error: "Only a verified domain can be set as primary", status: 400 };
  }

  await withTransaction(async (tx) => {
    await tx("UPDATE site_domains SET is_primary = false WHERE site_id = $1", [siteId]);
    await tx("UPDATE site_domains SET is_primary = true WHERE id = $1", [id]);
    await tx("UPDATE sites SET primary_host = $1 WHERE id = $2", [domain.hostname, siteId]);
  });

  return { ok: true };
}

/**
 * Resolve a request hostname to a live, verified site — used by
 * middleware.ts's custom-domain branch. Deliberately requires both
 * `status='verified'` and the site to still be live (not deleted/purged);
 * a removed or trashed site's old domain simply stops resolving, same as
 * any other addressing path in this app.
 */
export interface SiteDomainView {
  id: string;
  hostname: string;
  dnsRecords: DnsRecord[];
  status: DomainStatus;
  certStatus: CertStatus;
  verifiedAt: string | null;
  isPrimary: boolean;
  createdAt: string;
}

export function toDomainView(d: SiteDomainRow): SiteDomainView {
  return {
    id: d.id,
    hostname: d.hostname,
    dnsRecords: d.dns_records,
    status: d.status,
    certStatus: d.cert_status,
    verifiedAt: d.verified_at ? new Date(d.verified_at).toISOString() : null,
    isPrimary: d.is_primary,
    createdAt: new Date(d.created_at).toISOString(),
  };
}

export async function siteSlugForVerifiedHostname(hostname: string): Promise<string | null> {
  const rows = await query<{ slug: string }>(
    `SELECT s.slug FROM site_domains d
       JOIN sites s ON s.id = d.site_id
      WHERE d.hostname = $1 AND d.status = 'verified'
        AND s.deleted_at IS NULL AND s.purged_at IS NULL`,
    [hostname],
  );
  return rows[0]?.slug ?? null;
}
