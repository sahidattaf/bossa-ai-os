/**
 * Read-only legacy-data export for Phase 4.5 Lane A's "Legacy Preservation
 * Gate" (docs/PRODUCTION_DEPLOYMENT.md § 1) — issues #20/#22/#23. Exports an
 * allow-listed, fixed set of tables from either legacy Supabase project
 * (`bossa-ai-os` or `Bossa Asado i Mar`) to a local, gitignored directory as
 * JSON, with a SHA-256-checksummed manifest, before any migration or
 * schema-collision cleanup touches either project.
 *
 * This file is intentionally thin: it only wires real implementations of
 * three small interfaces (LegacyTableReader, AuthIdentityReader,
 * FileSystemPort — scripts/lib/legacy-export-io.ts) to the real Supabase
 * client and real node:fs. Every actual rule — project-ref binding, two-pass
 * source-stability checking, atomic run publication, manifest completeness
 * — lives in scripts/lib/legacy-export-plan.ts and
 * scripts/lib/legacy-export-io.ts, both fully unit-tested with mocked
 * readers and a real temporary filesystem, with no Supabase client or
 * network access involved.
 *
 * This tool has NO delete, update, upsert, or DDL capability anywhere in
 * this file — it only ever issues `.select()` reads against the fixed
 * per-project table allow-list, plus the GoTrue admin `listUsers()` read for
 * auth-identity metadata (never `.from("auth.users")`, which isn't exposed
 * via PostgREST at all — and never any password/token field, since GoTrue's
 * admin API doesn't return one in the first place).
 *
 * Every run gets its own immutable directory
 * (`.legacy-exports/<project>/<runId>/`, or `<runId>-failed` for a failed
 * run) — nothing is ever written directly into the project root, and an
 * existing run directory is never reused or overwritten. See
 * scripts/lib/legacy-export-io.ts's `publishRun()` for the exact atomic
 * publication contract.
 *
 * DRY RUN / LIST MODE BY DEFAULT. Nothing is written to disk unless
 * --confirm is passed.
 *
 * Usage (PowerShell):
 *   $env:LEGACY_SUPABASE_URL = "https://oqmftkttkfktyzefswpz.supabase.co"
 *   $env:LEGACY_SUPABASE_SECRET_KEY = "..."
 *   npm run export:legacy-data -- --project=bossa-ai-os
 *   npm run export:legacy-data -- --project=bossa-ai-os --confirm
 *
 * LEGACY_SUPABASE_URL/LEGACY_SUPABASE_SECRET_KEY are deliberately separate
 * from NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SECRET_KEY (lib/supabase/service-
 * role.ts) — this tool targets a different, legacy project per invocation,
 * never the application's own configured project, and these variables are
 * never set in Vercel (see docs/PRODUCTION_DEPLOYMENT.md § 6).
 */
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

import {
  buildExportManifest,
  buildManifestEntry,
  buildRunId,
  computeDataChecksum,
  describeExportPlan,
  extractProjectRefFromUrl,
  assertProjectRefMatches,
  LEGACY_PROJECT_SPECS,
  parseArgs,
  requiredDatasetsFor,
  safeJoin,
  sha256Hex,
  type ManifestEntry,
} from "./lib/legacy-export-plan";
import { createNodeFileSystemPort, createSupabaseAuthIdentityReader, createSupabaseTableReader } from "./lib/legacy-export-adapters";
import { fetchAuthIdentitiesStable, fetchTableStable, publishRun, type PreparedFile } from "./lib/legacy-export-io";

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.project) {
    console.error("Usage: --project=bossa-ai-os|bossa-asado-i-mar [--out=<dir>] [--confirm]");
    process.exitCode = 1;
    return;
  }

  const spec = LEGACY_PROJECT_SPECS[args.project];

  console.log(`Legacy export plan for "${args.project}":`);
  for (const line of describeExportPlan(args.project)) {
    console.log(`  ${line}`);
  }

  if (!args.confirm) {
    console.log("\nDRY RUN — no files written, no rows downloaded. Re-run with --confirm to export.");
    return;
  }

  const url = process.env.LEGACY_SUPABASE_URL;
  const secretKey = process.env.LEGACY_SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    console.error("LEGACY_SUPABASE_URL and LEGACY_SUPABASE_SECRET_KEY must both be set in the environment to export for real.");
    process.exitCode = 1;
    return;
  }

  const sourceProjectRef = extractProjectRefFromUrl(url);
  // Fails closed before any client is constructed or any table is read.
  assertProjectRefMatches(args.project, sourceProjectRef);

  const runId = buildRunId(new Date(), randomUUID());
  console.log(`\n--confirm passed. Project ref "${sourceProjectRef}" matches --project=${args.project}. Run id "${runId}".\n`);

  const supabase = createClient(url, secretKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const tableReader = createSupabaseTableReader(supabase);
  const authReader = createSupabaseAuthIdentityReader(supabase);
  const fs = createNodeFileSystemPort();

  const requiredDatasets = requiredDatasetsFor(args.project);
  const completedDatasets: string[] = [];
  const entries: ManifestEntry[] = [];
  const failures: Array<{ dataset: string; error: string }> = [];
  const files: PreparedFile[] = [];

  for (const table of spec.tables) {
    try {
      const { rows } = await fetchTableStable(tableReader, table);
      const exportedAt = new Date().toISOString();
      const dataChecksumSha256 = computeDataChecksum(rows);
      const content = JSON.stringify({ sourceProjectRef, table, exportedAt, rowCount: rows.length, dataChecksumSha256, rows }, null, 2);
      const fileChecksumSha256 = sha256Hex(content);

      files.push({ relativePath: `${table}.json`, content, expectedFileChecksumSha256: fileChecksumSha256 });
      entries.push(buildManifestEntry({ dataset: table, rowCount: rows.length, dataChecksumSha256, fileChecksumSha256 }));
      completedDatasets.push(table);
      console.log(`  ✓ ${table}: ${rows.length} row(s), stable across two independent reads`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ dataset: table, error: message });
      console.error(`  ✗ ${table}: ${message}`);
    }
  }

  if (spec.includeAuthIdentities) {
    const dataset = "auth-identities";
    try {
      const identities = await fetchAuthIdentitiesStable(authReader);
      const exportedAt = new Date().toISOString();
      const dataChecksumSha256 = computeDataChecksum(identities);
      const content = JSON.stringify(
        { sourceProjectRef, table: "auth.users (identity metadata only)", exportedAt, rowCount: identities.length, dataChecksumSha256, rows: identities },
        null,
        2,
      );
      const fileChecksumSha256 = sha256Hex(content);

      files.push({ relativePath: "auth-identities.json", content, expectedFileChecksumSha256: fileChecksumSha256 });
      entries.push(buildManifestEntry({ dataset, rowCount: identities.length, dataChecksumSha256, fileChecksumSha256 }));
      completedDatasets.push(dataset);
      console.log(`  ✓ ${dataset}: ${identities.length} row(s), stable across two independent reads, sorted by id`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ dataset, error: message });
      console.error(`  ✗ ${dataset}: ${message}`);
    }
  }

  const manifest = buildExportManifest({
    runId,
    project: args.project,
    sourceProjectRef,
    generatedAt: new Date().toISOString(),
    requiredDatasets,
    completedDatasets,
    entries,
    failures,
  });

  const projectDir = safeJoin(args.outDir, args.project);

  try {
    const { publishedPath } = await publishRun(fs, { projectDir, runId, files, manifest });
    if (manifest.status === "failed") {
      console.error(`\nExport FAILED for ${failures.length} dataset(s) — recorded at ${publishedPath} (manifest only, no data files)`);
      process.exitCode = 1;
      return;
    }
    console.log(`\nExport completed -> ${publishedPath}`);
  } catch (error) {
    console.error(`\nPublication failed: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("Unhandled error while exporting legacy Supabase data:", error);
  process.exitCode = 1;
});
