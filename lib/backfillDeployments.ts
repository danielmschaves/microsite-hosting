import { query, type SiteRow, type SiteVersionRow, type VersionRow } from "./db";
import { headObject } from "./storage";

// ---------------------------------------------------------------------------
// R0 backfill (CD-02): populate `versions`/`deployments` from the existing
// `sites`/`site_versions` tables without touching either. This is the
// highest-risk migration in the PRD's own words — pure addition, re-runnable,
// and paired with a read-only verifier below. Callable both as a library
// function (for the pre-deploy rehearsal, `npx tsx` style) and from
// app/api/admin/backfill-deployments/route.ts.
// ---------------------------------------------------------------------------

export interface BackfillResult {
  dryRun: boolean;
  versionsInserted: number;
  deploymentsCreated: number;
  sitesUpdated: number;
}

/**
 * For every `site_versions` row with no matching `versions` row, insert one.
 * For every live site with no `production_deployment_id` yet, create a
 * synthetic `deployments` row (`target='production', status='published'`)
 * pointing at its current version and set the pointer. Idempotent — safe to
 * re-run; already-backfilled rows are skipped.
 */
export async function backfillDeployments(
  opts: { dryRun?: boolean } = {},
): Promise<BackfillResult> {
  const dryRun = opts.dryRun ?? false;

  const missingVersions = await query<SiteVersionRow>(
    `SELECT sv.* FROM site_versions sv
       LEFT JOIN versions v ON v.site_id = sv.site_id AND v.number = sv.version
      WHERE v.id IS NULL`,
  );

  let versionsInserted = 0;
  if (!dryRun) {
    for (const sv of missingVersions) {
      await query(
        `INSERT INTO versions (site_id, number, storage_key, content_digest, source, author_email, actor_type, created_at)
         VALUES ($1, $2, $3, NULL, 'upload', $4, 'human', $5)
         ON CONFLICT (site_id, number) DO NOTHING`,
        [sv.site_id, sv.version, sv.s3_prefix, sv.created_by, sv.created_at],
      );
      versionsInserted++;
    }
  } else {
    versionsInserted = missingVersions.length;
  }

  const candidateSites = await query<SiteRow>(
    `SELECT * FROM sites
      WHERE deleted_at IS NULL AND production_deployment_id IS NULL`,
  );

  let deploymentsCreated = 0;
  let sitesUpdated = 0;
  for (const site of candidateSites) {
    const versionRows = await query<VersionRow>(
      "SELECT * FROM versions WHERE site_id = $1 AND number = $2",
      [site.id, site.current_version],
    );
    const version = versionRows[0];
    if (!version) continue; // shouldn't happen once versionsInserted lands; safe to skip and retry next run

    if (dryRun) {
      deploymentsCreated++;
      sitesUpdated++;
      continue;
    }

    const deployed = await query<{ id: string }>(
      `INSERT INTO deployments (site_id, version_id, target, status, created_by, actor_type, published_at, created_at)
       VALUES ($1, $2, 'production', 'published', $3, 'human', $4, $4)
       RETURNING id`,
      [site.id, version.id, site.owner_email, site.created_at],
    );
    const deploymentId = deployed[0].id;
    deploymentsCreated++;

    await query("UPDATE sites SET production_deployment_id = $1 WHERE id = $2", [
      deploymentId,
      site.id,
    ]);
    sitesUpdated++;
  }

  return { dryRun, versionsInserted, deploymentsCreated, sitesUpdated };
}

export interface ParityMismatch {
  siteId: string;
  slug: string;
  reason: string;
}

export interface ParityReport {
  checked: number;
  mismatches: ParityMismatch[];
  sampledStorageChecks: number;
  sampledStorageFailures: number;
}

/**
 * Read-only cross-check that the new `versions`/`deployments` rows address
 * the exact same content as the old `sites`/`site_versions` columns still
 * being served. Run twice on separate days against a snapshot before trusting
 * lib/deployments.ts to write on top of live traffic (see CLAUDE.md's R0
 * gate). Never mutates anything; the one storage call is a HEAD, not a GET.
 */
export async function verifyAddressingParity(
  opts: { sampleStorage?: boolean } = { sampleStorage: true },
): Promise<ParityReport> {
  const sites = await query<SiteRow>(
    "SELECT * FROM sites WHERE deleted_at IS NULL",
  );

  const mismatches: ParityMismatch[] = [];
  let sampledStorageChecks = 0;
  let sampledStorageFailures = 0;

  for (const site of sites) {
    const versionRows = await query<VersionRow>(
      "SELECT * FROM versions WHERE site_id = $1 AND number = $2",
      [site.id, site.current_version],
    );
    const version = versionRows[0];
    if (!version) {
      mismatches.push({ siteId: site.id, slug: site.slug, reason: "no versions row for current_version" });
      continue;
    }
    if (version.storage_key !== site.s3_prefix) {
      mismatches.push({
        siteId: site.id,
        slug: site.slug,
        reason: `storage_key mismatch: versions has "${version.storage_key}", sites has "${site.s3_prefix}"`,
      });
    }

    if (site.production_deployment_id) {
      const deploymentRows = await query<{ version_id: string }>(
        "SELECT version_id FROM deployments WHERE id = $1",
        [site.production_deployment_id],
      );
      const deployment = deploymentRows[0];
      if (!deployment || deployment.version_id !== version.id) {
        mismatches.push({
          siteId: site.id,
          slug: site.slug,
          reason: "production_deployment_id does not resolve to the current version",
        });
      }
    } else {
      mismatches.push({ siteId: site.id, slug: site.slug, reason: "production_deployment_id is not set" });
    }

    // Only 'upload'-sourced versions map 1:1 to site_versions rows — preview
    // deployments (CD-09) insert their own 'agent'-sourced versions rows with
    // negative numbers that never touch site_versions at all, so they must
    // be excluded from this comparison or every site with a preview would
    // permanently fail parity.
    const counts = await query<{ old_count: string; new_count: string }>(
      `SELECT
         (SELECT count(*) FROM site_versions WHERE site_id = $1) AS old_count,
         (SELECT count(*) FROM versions WHERE site_id = $1 AND source = 'upload') AS new_count`,
      [site.id],
    );
    if (Number(counts[0].old_count) !== Number(counts[0].new_count)) {
      mismatches.push({
        siteId: site.id,
        slug: site.slug,
        reason: `version row count mismatch: site_versions=${counts[0].old_count}, versions=${counts[0].new_count}`,
      });
    }

    if (opts.sampleStorage) {
      sampledStorageChecks++;
      const head = await headObject(site.index_key).catch(() => null);
      if (!head) {
        sampledStorageFailures++;
        mismatches.push({
          siteId: site.id,
          slug: site.slug,
          reason: `index_key "${site.index_key}" not found in storage`,
        });
      }
    }
  }

  return { checked: sites.length, mismatches, sampledStorageChecks, sampledStorageFailures };
}
