/**
 * I/O-adjacent orchestration for scripts/export-legacy-supabase-data.ts —
 * pagination, the two-pass source-stability check, and atomic run
 * publication. Everything here is written against small injectable
 * interfaces (LegacyTableReader, AuthIdentityReader, FileSystemPort)
 * rather than a real Supabase client or node:fs directly, so it can be
 * exercised in tests with mocked query chains, a real temporary directory,
 * and injected write/rename failures — without any network access or real
 * file risk. scripts/export-legacy-supabase-data.ts supplies the real
 * implementations of these interfaces; this module never imports
 * `@supabase/supabase-js` or `node:fs` itself.
 */
import {
  buildExportManifest,
  computeDataChecksum,
  safeJoin,
  sha256Hex,
  validateTableCompleteness,
  type ExportManifest,
  type LegacyProjectKey,
} from "./legacy-export-plan";

export interface LegacyRow {
  id: unknown;
  [key: string]: unknown;
}

/** The minimal read surface this tool needs from a table — implemented for real against `.from(table).select(...).order("id").range(...)`, and trivially fakeable in tests. */
export interface LegacyTableReader {
  getExactCount(table: string): Promise<number>;
  /** Must return rows ordered by `id` ascending, for the exact [offset, offset + limit) window. */
  getPage(table: string, offset: number, limit: number): Promise<LegacyRow[]>;
}

const DEFAULT_PAGE_SIZE = 500;

async function fetchAllRowsOnce(reader: LegacyTableReader, table: string, pageSize: number): Promise<{ rows: LegacyRow[]; exactCount: number }> {
  const exactCount = await reader.getExactCount(table);
  const rows: LegacyRow[] = [];
  let offset = 0;
  for (;;) {
    const page = await reader.getPage(table, offset, pageSize);
    rows.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }
  return { rows, exactCount };
}

/**
 * Reads a table twice, independently, end to end — pagination and the
 * per-table row count don't share one database transaction, so nothing
 * guarantees the table looked the same for the whole read. Each pass is
 * validated on its own (exact-count match, no duplicate ids); the two
 * passes are then compared to each other on both count and a canonical
 * content checksum. Any disagreement aborts the table entirely rather than
 * exporting a read that might be internally torn.
 */
export async function fetchTableStable(reader: LegacyTableReader, table: string, pageSize: number = DEFAULT_PAGE_SIZE): Promise<{ rows: LegacyRow[]; exactCount: number }> {
  const first = await fetchAllRowsOnce(reader, table, pageSize);
  validateTableCompleteness(first.rows, first.exactCount, table);

  const second = await fetchAllRowsOnce(reader, table, pageSize);
  validateTableCompleteness(second.rows, second.exactCount, table);

  if (first.exactCount !== second.exactCount) {
    throw new Error(
      `Source data for "${table}" changed during export: row count differed between two consecutive reads (${first.exactCount} vs ${second.exactCount})`,
    );
  }
  if (computeDataChecksum(first.rows) !== computeDataChecksum(second.rows)) {
    throw new Error(`Source data for "${table}" changed during export: content differed between two consecutive reads despite matching row counts`);
  }

  return first;
}

export interface SafeAuthIdentity {
  id: string;
  email: string | undefined;
  createdAt: string | undefined;
  confirmedAt: string | undefined;
  lastSignInAt: string | undefined;
}

export interface RawLegacyAuthUser {
  id: string;
  email?: string;
  created_at?: string;
  confirmed_at?: string;
  email_confirmed_at?: string;
  last_sign_in_at?: string;
}

/** The minimal read surface for legacy auth identities — implemented for real against GoTrue's admin `listUsers()`, fakeable in tests. */
export interface AuthIdentityReader {
  listUsersPage(page: number, perPage: number): Promise<{ users: RawLegacyAuthUser[] }>;
}

async function fetchAuthIdentitiesOnce(reader: AuthIdentityReader, perPage = 200): Promise<SafeAuthIdentity[]> {
  const identities: SafeAuthIdentity[] = [];
  for (let page = 1; ; page += 1) {
    const { users } = await reader.listUsersPage(page, perPage);
    for (const user of users) {
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
    if (users.length < perPage) break;
  }
  identities.sort((a, b) => a.id.localeCompare(b.id));
  return identities;
}

/** Same two-pass stability discipline as fetchTableStable, applied to the GoTrue admin listing instead of a PostgREST table — paginates with no artificial page cap, sorts by id, and aborts if the two passes disagree. */
export async function fetchAuthIdentitiesStable(reader: AuthIdentityReader): Promise<SafeAuthIdentity[]> {
  const first = await fetchAuthIdentitiesOnce(reader);
  const second = await fetchAuthIdentitiesOnce(reader);

  if (first.length !== second.length || computeDataChecksum(first) !== computeDataChecksum(second)) {
    throw new Error("Source auth-identity data changed during export: content differed between two consecutive reads");
  }

  return first;
}

export interface FileSystemPort {
  mkdir(targetPath: string, options: { recursive: true }): Promise<void>;
  writeFile(targetPath: string, content: string): Promise<void>;
  readFile(targetPath: string): Promise<string>;
  rename(oldPath: string, newPath: string): Promise<void>;
  rm(targetPath: string, options: { recursive: true; force: true }): Promise<void>;
  pathExists(targetPath: string): Promise<boolean>;
}

export interface PreparedFile {
  relativePath: string;
  content: string;
  expectedFileChecksumSha256: string;
}

export interface PublishRunParams {
  projectDir: string;
  runId: string;
  files: PreparedFile[];
  manifest: ExportManifest;
}

export interface PublishRunResult {
  publishedPath: string;
}

/**
 * Publishes one export run atomically. Everything is written into a
 * `.staging-<runId>` directory first; the ONLY thing that makes a run
 * "published" is a single directory rename from staging to its final name
 * — never a sequence of file writes directly into a run's final location.
 *
 * - `manifest.status === "failed"` (a data-collection failure already
 *   happened): writes ONLY a manifest.json into staging — no per-table data
 *   file is ever written for a failed run, even for datasets that
 *   individually succeeded — then renames staging to `<runId>-failed`.
 * - `manifest.status === "completed"`: writes every prepared file, then the
 *   manifest, then re-reads every written file (including the manifest)
 *   from disk and verifies its checksum/content matches what was intended,
 *   and only if every one of those checks passes does it rename staging to
 *   the final `<runId>` directory. If ANY step in this branch throws —
 *   a write, a checksum mismatch, the rename itself — the staging
 *   directory is torn down and replaced with a `<runId>-failed` directory
 *   containing only a freshly-built failed manifest describing the
 *   publication failure, and the original error is re-thrown. A prior
 *   completed run directory is never touched by any of this, and a
 *   completed run directory can never appear unless the rename actually
 *   succeeded.
 *
 * Refuses outright if a directory already exists at any of the three
 * possible names for this run id (staging, completed, or failed) — a
 * run id must never be reused to overwrite a previous attempt's record.
 */
export async function publishRun(fs: FileSystemPort, params: PublishRunParams): Promise<PublishRunResult> {
  const stagingDir = safeJoin(params.projectDir, `.staging-${params.runId}`);
  const finalDir = safeJoin(params.projectDir, params.runId);
  const failedDir = safeJoin(params.projectDir, `${params.runId}-failed`);

  if (await fs.pathExists(finalDir)) {
    throw new Error(`Refusing to reuse run id "${params.runId}": a completed run directory already exists at "${finalDir}"`);
  }
  if (await fs.pathExists(stagingDir)) {
    throw new Error(`Refusing to reuse run id "${params.runId}": a staging directory already exists at "${stagingDir}"`);
  }
  if (await fs.pathExists(failedDir)) {
    throw new Error(`Refusing to reuse run id "${params.runId}": a failed-run directory already exists at "${failedDir}"`);
  }

  await fs.mkdir(stagingDir, { recursive: true });

  if (params.manifest.status === "failed") {
    await fs.writeFile(safeJoin(stagingDir, "manifest.json"), JSON.stringify(params.manifest, null, 2));
    await fs.rename(stagingDir, failedDir);
    return { publishedPath: failedDir };
  }

  try {
    for (const file of params.files) {
      await fs.writeFile(safeJoin(stagingDir, file.relativePath), file.content);
    }
    const manifestContent = JSON.stringify(params.manifest, null, 2);
    await fs.writeFile(safeJoin(stagingDir, "manifest.json"), manifestContent);

    for (const file of params.files) {
      const onDisk = await fs.readFile(safeJoin(stagingDir, file.relativePath));
      if (sha256Hex(onDisk) !== file.expectedFileChecksumSha256) {
        throw new Error(`On-disk checksum verification failed for "${file.relativePath}" — refusing to publish`);
      }
    }
    const onDiskManifest = await fs.readFile(safeJoin(stagingDir, "manifest.json"));
    if (onDiskManifest !== manifestContent) {
      throw new Error("On-disk verification failed for manifest.json — refusing to publish");
    }

    await fs.rename(stagingDir, finalDir);
    return { publishedPath: finalDir };
  } catch (publishError) {
    const publishErrorMessage = publishError instanceof Error ? publishError.message : String(publishError);
    const failureManifest = buildExportManifest({
      runId: params.manifest.runId,
      project: params.manifest.project as LegacyProjectKey,
      sourceProjectRef: params.manifest.sourceProjectRef,
      generatedAt: new Date().toISOString(),
      requiredDatasets: params.manifest.requiredDatasets,
      completedDatasets: [],
      entries: [],
      failures: [{ dataset: "publication", error: publishErrorMessage }],
    });

    await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
    await fs.mkdir(stagingDir, { recursive: true });
    await fs.writeFile(safeJoin(stagingDir, "manifest.json"), JSON.stringify(failureManifest, null, 2));
    await fs.rename(stagingDir, failedDir);

    throw publishError;
  }
}
