import { createHash } from "crypto";
import { query } from "./db";
import { putObject, getObject, headObject, deletePrefix } from "./storage";

// ---------------------------------------------------------------------------
// Content-addressed storage (PRD v2.0 CD-04). A layer on top of
// lib/storage.ts, not a rewrite of it — putObject/getObject/headObject/
// deletePrefix keep their exact existing signatures. Not on the critical
// path to any of the 14 R1 tools; versions.content_digest simply stays NULL
// for anything published before this lands (CD-02's verifier already treats
// that as valid). Refcounting lives in Postgres (cas_refs), since S3 has no
// atomic refcount primitive.
// ---------------------------------------------------------------------------

export function digestOf(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/** Sharded key: avoids one huge flat "cas/" prefix in S3/MinIO listings. */
export function casKey(digest: string): string {
  return `cas/${digest.slice(0, 2)}/${digest}`;
}

export interface CasPutResult {
  digest: string;
  key: string;
  deduped: boolean;
}

/** Write `buffer` content-addressed, deduping against any existing object with the same digest. */
export async function putContentAddressed(
  buffer: Buffer,
  contentType: string,
): Promise<CasPutResult> {
  const digest = digestOf(buffer);
  const key = casKey(digest);
  const existing = await headObject(key);
  if (!existing) {
    await putObject(key, buffer, contentType);
  }
  return { digest, key, deduped: Boolean(existing) };
}

export async function getContentAddressed(digest: string) {
  return getObject(casKey(digest));
}

/** Record that `versionId` references `digest` — call once per file written via putContentAddressed. */
export async function addCasRef(digest: string, versionId: string): Promise<void> {
  await query(
    "INSERT INTO cas_refs (digest, version_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [digest, versionId],
  );
}

/**
 * Release every digest a version referenced, deleting the underlying object
 * for any digest that just lost its last reference. Never calls
 * deletePrefix() on a CAS path — unrelated versions share the `cas/<shard>/`
 * prefix, so only single-object deletes are safe here. Call this instead of
 * deletePrefix(version.storage_key) whenever version.content_digest IS NOT
 * NULL; legacy prefix-addressed versions keep using deletePrefix() as-is.
 */
export async function releaseCasRefs(versionId: string): Promise<void> {
  const digests = await query<{ digest: string }>(
    "DELETE FROM cas_refs WHERE version_id = $1 RETURNING digest",
    [versionId],
  );
  for (const { digest } of digests) {
    const stillReferenced = await query<{ digest: string }>(
      "SELECT digest FROM cas_refs WHERE digest = $1 LIMIT 1",
      [digest],
    );
    if (stillReferenced.length === 0) {
      // A single object at a fully-qualified key — safe as a "prefix" delete
      // since sharded digest keys are unique per object, never a directory.
      await deletePrefix(casKey(digest)).catch((err) => {
        console.error(`[cas] gc failed for digest ${digest}`, err);
      });
    }
  }
}
