/**
 * Read-only legacy-data export for Phase 4.5 Lane A's "Legacy Preservation
 * Gate" (docs/PRODUCTION_DEPLOYMENT.md § 1) — issues #20/#22. Exports an
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
 * Project-ref binding: --project selects a fixed allow-list AND a fixed
 * expected project ref (scripts/lib/legacy-export-plan.ts's
 * LEGACY_PROJECT_SPECS). The ref actually reachable at LEGACY_SUPABASE_URL
 * is checked against that expectation BEFORE a Supabase client is
 * constructed or any table is read — a cross-wired URL (the wrong
 * project's URL supplied for a given --project) is refused outright rather
 * than silently querying the wrong database with the wrong allow-list.
 *
 * Determinism and completeness: every table read is ordered by `id`
 * ascending, paginated until exhaustion, and checked against the table's
 * own exact row count with no duplicate ids across pages. A table's JSON
 * file is only ever written after that validation passes. If ANY requested
 * dataset (table or auth identities) fails for any reason, NO per-table
 * file is written at all — only a manifest with `status: "failed"` — so a
 * partial run can never be mistaken for a complete, verified export.
 *
 * DRY RUN / LIST MODE BY DEFAULT. Nothing is written to disk unless
 * --confirm is passed. Even then, the only side effect is writing files
 * under --out (default .legacy-exports/, already in .gitignore) — never a
 * database write of any kind.
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
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  assertProjectRefMatches,
  buildExportManifest,
  buildManifestEntry,
  describeExportPlan,
  extractProjectRefFromUrl,
  LEGACY_PROJECT_SPECS,
  parseArgs,
  safeJoin,
  sha256Hex,
  validateTableCompleteness,
  type LegacyProjectKey,
  type ManifestEntry,
} from "./lib/legacy-export-plan";

const PAGE_SIZE = 500;

interface SafeAuthIdentity {
  id: string;
  email: string | undefined;
  createdAt: string | undefined;
  confirmedAt: string | undefined;
  lastSignInAt: string | undefined;
}

interface PendingWrite {
  filePath: string;
  content: string;
}

/** Reads every row of `table`, ordered by id ascending, paginating until exhaustion, and validates the result against the table's own exact count with no duplicate ids across pages. Never partial: either every row comes back validated, or this throws and nothing is written. */
async function fetchAllRows(supabase: SupabaseClient, table: string): Promise<{ rows: Array<{ id: unknown }>; exactCount: number }> {
  const { count, error: countError } = await supabase.from(table).select("id", { count: "exact", head: true });
  if (countError) {
    throw new Error(`Failed to read the exact row count for "${table}": ${countError.message}`);
  }
  const exactCount = count ?? 0;

  const rows: Array<{ id: unknown }> = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) {
      throw new Error(`Failed to read "${table}" at offset ${offset}: ${error.message}`);
    }
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  validateTableCompleteness(rows, exactCount, table);
  return { rows, exactCount };
}

/** Validates one table fully in memory and, on success, returns the file write to perform later plus its manifest entry — writes nothing itself. */
async function prepareTableExport(
  supabase: SupabaseClient,
  project: LegacyProjectKey,
  sourceProjectRef: string,
  table: string,
  outDir: string,
): Promise<{ write: PendingWrite; entry: ManifestEntry }> {
  const { rows } = await fetchAllRows(supabase, table);
  const exportedAt = new Date().toISOString();
  const content = JSON.stringify({ sourceProjectRef, table, exportedAt, rowCount: rows.length, rows }, null, 2);
  const checksum = sha256Hex(content);
  const filePath = safeJoin(outDir, project, `${table}.json`);

  console.log(`  ✓ validated "${table}": ${rows.length} row(s), ordered by id, no duplicates, checksum computed`);

  return {
    write: { filePath, content },
    entry: buildManifestEntry({ sourceProjectRef, table, exportedAt, rowCount: rows.length, checksumSha256: checksum }),
  };
}

/** Pages through every legacy auth user with no artificial page cap, sorts by id for deterministic output, and returns only the safe identity fields — never a password hash, token, or recovery field, since GoTrue's admin API doesn't return one in the first place and this only ever picks specific known-safe fields regardless. */
async function prepareAuthIdentitiesExport(
  supabase: SupabaseClient,
  project: LegacyProjectKey,
  sourceProjectRef: string,
  outDir: string,
): Promise<{ write: PendingWrite; entry: ManifestEntry }> {
  const identities: SafeAuthIdentity[] = [];
  const perPage = 200;
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) {
      throw new Error(`Failed to list legacy auth users (page ${page}): ${error.message}`);
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
    if (data.users.length < perPage) break;
  }

  identities.sort((a, b) => a.id.localeCompare(b.id));

  const table = "auth.users (identity metadata only)";
  const exportedAt = new Date().toISOString();
  const content = JSON.stringify({ sourceProjectRef, table, exportedAt, rowCount: identities.length, rows: identities }, null, 2);
  const checksum = sha256Hex(content);
  const filePath = safeJoin(outDir, project, "auth-identities.json");

  console.log(`  ✓ validated auth identities: ${identities.length} row(s), sorted by id, checksum computed`);

  return {
    write: { filePath, content },
    entry: buildManifestEntry({ sourceProjectRef, table, exportedAt, rowCount: identities.length, checksumSha256: checksum }),
  };
}

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

  console.log(`\n--confirm passed. Project ref "${sourceProjectRef}" matches --project=${args.project}. Reading from "${args.outDir}/${args.project}"...\n`);

  const supabase = createClient(url, secretKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const pendingWrites: PendingWrite[] = [];
  const entries: ManifestEntry[] = [];
  const failures: Array<{ table: string; error: string }> = [];

  for (const table of spec.tables) {
    try {
      const { write, entry } = await prepareTableExport(supabase, args.project, sourceProjectRef, table, args.outDir);
      pendingWrites.push(write);
      entries.push(entry);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ table, error: message });
      console.error(`  ✗ ${table}: ${message}`);
    }
  }

  if (spec.includeAuthIdentities) {
    try {
      const { write, entry } = await prepareAuthIdentitiesExport(supabase, args.project, sourceProjectRef, args.outDir);
      pendingWrites.push(write);
      entries.push(entry);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ table: "auth-identities", error: message });
      console.error(`  ✗ auth-identities: ${message}`);
    }
  }

  const manifest = buildExportManifest({
    project: args.project,
    sourceProjectRef,
    generatedAt: new Date().toISOString(),
    entries,
    failures,
  });

  const manifestPath = safeJoin(args.outDir, args.project, "manifest.json");

  if (manifest.status === "failed") {
    // Write ONLY the failure manifest — no per-table data file, from any
    // dataset, is written when any dataset fails. A partial run must never
    // look like a completed one on disk.
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
    console.error(`\nExport FAILED for ${failures.length} dataset(s) — no data files written, only the failure manifest -> ${manifestPath}`);
    process.exitCode = 1;
    return;
  }

  for (const { filePath, content } of pendingWrites) {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content, "utf8");
    console.log(`  -> wrote ${filePath}`);
  }
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  console.log(`\nManifest (completed) written -> ${manifestPath}`);
}

main().catch((error) => {
  console.error("Unhandled error while exporting legacy Supabase data:", error);
  process.exitCode = 1;
});
