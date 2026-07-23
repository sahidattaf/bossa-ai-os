/**
 * Read-only legacy-data export for Phase 4.5 Lane A's "Legacy Preservation
 * Gate" (docs/PRODUCTION_DEPLOYMENT.md § 1) — issue #20. Exports an
 * allow-listed, fixed set of tables from either legacy Supabase project
 * (`bossa-ai-os` or `Bossa Asado i Mar`) to a local, gitignored directory as
 * JSON, with a SHA-256-checksummed manifest, before any migration or
 * schema-collision cleanup touches either project.
 *
 * This tool has NO delete, update, upsert, or DDL capability anywhere in
 * this file — it only ever issues `.select()` reads against the fixed
 * per-project table allow-list in scripts/lib/legacy-export-plan.ts, plus
 * the GoTrue admin `listUsers()` read for auth-identity metadata (never
 * `.from("auth.users")`, which isn't exposed via PostgREST at all — and
 * never any password/token field, since GoTrue's admin API doesn't return
 * one in the first place).
 *
 * DRY RUN / LIST MODE BY DEFAULT. Nothing is written to disk unless
 * --confirm is passed. Even then, the only side effect is writing files
 * under --out (default .legacy-exports/, already in .gitignore) — never a
 * database write of any kind.
 *
 * Usage:
 *   LEGACY_SUPABASE_URL=https://oqmftkttkfktyzefswpz.supabase.co \
 *   LEGACY_SUPABASE_SECRET_KEY=... \
 *     npm run export:legacy-data -- --project=bossa-ai-os
 *
 *   LEGACY_SUPABASE_URL=https://zgfncoexiqnqeqaxpqdy.supabase.co \
 *   LEGACY_SUPABASE_SECRET_KEY=... \
 *     npm run export:legacy-data -- --project=bossa-asado-i-mar --confirm
 *
 * LEGACY_SUPABASE_URL/LEGACY_SUPABASE_SECRET_KEY are deliberately separate
 * from NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SECRET_KEY (lib/supabase/service-
 * role.ts) — this tool targets a different, legacy project per invocation,
 * never the application's own configured project, and these variables are
 * never set in Vercel (see docs/PRODUCTION_DEPLOYMENT.md § 6).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  buildManifestEntry,
  describeExportPlan,
  extractProjectRefFromUrl,
  LEGACY_PROJECT_SPECS,
  parseArgs,
  safeJoin,
  sha256Hex,
  type LegacyProjectKey,
  type ManifestEntry,
} from "./lib/legacy-export-plan";

interface SafeAuthIdentity {
  id: string;
  email: string | undefined;
  createdAt: string | undefined;
  confirmedAt: string | undefined;
  lastSignInAt: string | undefined;
}

async function exportTable(
  supabase: SupabaseClient,
  project: LegacyProjectKey,
  sourceProjectRef: string,
  table: string,
  outDir: string,
): Promise<ManifestEntry> {
  const { data, error, count } = await supabase.from(table).select("*", { count: "exact" });
  if (error) {
    throw new Error(`Failed to read legacy table "${table}": ${error.message}`);
  }

  const rows = data ?? [];
  const exportedAt = new Date().toISOString();
  const content = JSON.stringify({ sourceProjectRef, table, exportedAt, rowCount: rows.length, rows }, null, 2);
  const checksum = sha256Hex(content);

  const filePath = safeJoin(outDir, project, `${table}.json`);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");

  console.log(`  ✓ ${table}: ${rows.length} row(s) (count=${count ?? "unknown"}) -> ${filePath}`);

  return buildManifestEntry({ sourceProjectRef, table, exportedAt, rowCount: rows.length, checksumSha256: checksum });
}

async function exportAuthIdentities(
  supabase: SupabaseClient,
  project: LegacyProjectKey,
  sourceProjectRef: string,
  outDir: string,
): Promise<ManifestEntry> {
  const identities: SafeAuthIdentity[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) {
      throw new Error(`Failed to list legacy auth users: ${error.message}`);
    }
    for (const user of data.users) {
      // Deliberately only these fields — never spread the full user object,
      // so a future SDK field can't accidentally leak into the export.
      identities.push({
        id: user.id,
        email: user.email,
        createdAt: user.created_at,
        confirmedAt: user.confirmed_at ?? user.email_confirmed_at ?? undefined,
        lastSignInAt: user.last_sign_in_at ?? undefined,
      });
    }
    if (data.users.length < 200) break;
  }

  const exportedAt = new Date().toISOString();
  const content = JSON.stringify(
    { sourceProjectRef, table: "auth.users (identity metadata only)", exportedAt, rowCount: identities.length, rows: identities },
    null,
    2,
  );
  const checksum = sha256Hex(content);

  const filePath = safeJoin(outDir, project, "auth-identities.json");
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");

  console.log(`  ✓ auth-identities: ${identities.length} row(s) -> ${filePath}`);

  return buildManifestEntry({
    sourceProjectRef,
    table: "auth.users (identity metadata only)",
    exportedAt,
    rowCount: identities.length,
    checksumSha256: checksum,
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.project) {
    console.error('Usage: --project=bossa-ai-os|bossa-asado-i-mar [--out=<dir>] [--confirm]');
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
  console.log(`\n--confirm passed. Exporting from "${sourceProjectRef}" to "${args.outDir}/${args.project}"...\n`);

  const supabase = createClient(url, secretKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const manifestEntries: ManifestEntry[] = [];
  let failures = 0;

  for (const table of spec.tables) {
    try {
      manifestEntries.push(await exportTable(supabase, args.project, sourceProjectRef, table, args.outDir));
    } catch (error) {
      failures += 1;
      console.error(`  ✗ ${error instanceof Error ? error.message : error}`);
    }
  }

  if (spec.includeAuthIdentities) {
    try {
      manifestEntries.push(await exportAuthIdentities(supabase, args.project, sourceProjectRef, args.outDir));
    } catch (error) {
      failures += 1;
      console.error(`  ✗ ${error instanceof Error ? error.message : error}`);
    }
  }

  const manifestPath = safeJoin(args.outDir, args.project, "manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifestEntries, null, 2), "utf8");
  console.log(`\nManifest written -> ${manifestPath}`);

  if (failures > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("Unhandled error while exporting legacy Supabase data:", error);
  process.exitCode = 1;
});
