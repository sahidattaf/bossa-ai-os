/**
 * Pure planning logic for scripts/export-legacy-supabase-data.ts, kept in
 * its own module (no Supabase client, no filesystem I/O) so it can be
 * unit-tested without touching a real project or writing real files. See
 * scripts/lib/legacy-export-io.ts for the I/O-adjacent logic (pagination,
 * stability checks, atomic publication) built on top of this, and that
 * script's header comment / docs/PRODUCTION_DEPLOYMENT.md's "Legacy
 * Preservation Gate" for the full contract this exists to satisfy.
 */
import { createHash } from "node:crypto";
import path from "node:path";

export type LegacyProjectKey = "bossa-ai-os" | "bossa-asado-i-mar";

export interface LegacyProjectSpec {
  /** The one project ref this key is ever allowed to read from — checked against the URL actually supplied at runtime before any client is constructed or any table is read. */
  expectedProjectRef: string;
  /** Only these public tables are ever read — an explicit allow-list, never a client-supplied or discovered table name. */
  tables: readonly string[];
  /** Whether this project has any real auth.users worth exporting identity metadata for. */
  includeAuthIdentities: boolean;
}

/**
 * Matches docs/PRODUCTION_ACTIVATION_AUDIT.md §3's verified live findings
 * exactly: bossa-ai-os's non-empty legacy tables (campaigns, weekly_briefs,
 * kpi_daily, decision_log) plus its one auth user; Bossa Asado i Mar's only
 * table (bossa_leads), which has zero auth users to export.
 */
export const LEGACY_PROJECT_SPECS: Record<LegacyProjectKey, LegacyProjectSpec> = {
  "bossa-ai-os": {
    expectedProjectRef: "oqmftkttkfktyzefswpz",
    tables: ["campaigns", "weekly_briefs", "kpi_daily", "decision_log"],
    includeAuthIdentities: true,
  },
  "bossa-asado-i-mar": {
    expectedProjectRef: "zgfncoexiqnqeqaxpqdy",
    tables: ["bossa_leads"],
    includeAuthIdentities: false,
  },
};

/** Every dataset a given project's export run is required to complete — the exact set `completedDatasets` must match for the manifest to ever read "completed". */
export function requiredDatasetsFor(project: LegacyProjectKey): string[] {
  const spec = LEGACY_PROJECT_SPECS[project];
  return spec.includeAuthIdentities ? [...spec.tables, "auth-identities"] : [...spec.tables];
}

export interface ExportArgs {
  project?: LegacyProjectKey;
  outDir: string;
  confirm: boolean;
}

const DEFAULT_OUT_DIR = ".legacy-exports";

export function parseArgs(argv: string[]): ExportArgs {
  const result: ExportArgs = { outDir: DEFAULT_OUT_DIR, confirm: false };
  for (const arg of argv) {
    if (arg === "--confirm") {
      result.confirm = true;
      continue;
    }
    const [key, value] = arg.replace(/^--/, "").split("=");
    if (key === "project" && (value === "bossa-ai-os" || value === "bossa-asado-i-mar")) {
      result.project = value;
    }
    if (key === "out" && value) {
      result.outDir = value;
    }
  }
  return result;
}

/** A human-readable description of exactly what a run would read and export, used for both the dry-run printout and its unit test. */
export function describeExportPlan(project: LegacyProjectKey): string[] {
  const spec = LEGACY_PROJECT_SPECS[project];
  const lines: string[] = [];
  for (const table of spec.tables) {
    lines.push(`${project}: read-only export of "${table}" (two stable ordered reads, row count + full rows + a SHA-256 checksum, no writes)`);
  }
  if (spec.includeAuthIdentities) {
    lines.push(`${project}: read-only export of auth-user identity metadata (id, email, timestamps only — never password hashes or tokens)`);
  } else {
    lines.push(`${project}: no auth users to export (verified 0 at audit time)`);
  }
  return lines;
}

/** Deterministic SHA-256 hex digest of exported file content — the same content always produces the same checksum, which is the whole point of recording one. */
export function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** Recursively sorts object keys so JSON.stringify output is canonical regardless of property-insertion order — the same logical row set always stringifies identically. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * The canonical *data* checksum for a set of rows — deliberately excludes
 * any wrapping envelope field like `exportedAt`, so identical source data
 * produces the identical checksum on every run, today or a year from now.
 * This is what the source-stability check (two consecutive reads) and any
 * future "did this data change since export" comparison actually compares.
 */
export function computeDataChecksum(rows: ReadonlyArray<unknown>): string {
  return sha256Hex(stableStringify(rows));
}

/** Parses the project ref out of a Supabase project URL (e.g. "https://oqmftkttkfktyzefswpz.supabase.co" -> "oqmftkttkfktyzefswpz"), so the manifest can record the source project ref without it being separately, redundantly typed in twice. */
export function extractProjectRefFromUrl(url: string): string {
  const match = /^https?:\/\/([a-z0-9]+)\.supabase\.co/i.exec(url);
  if (!match) {
    throw new Error(`Could not extract a project ref from Supabase URL "${url}" — expected https://<ref>.supabase.co`);
  }
  return match[1]!;
}

/**
 * Fails closed on any project/ref mismatch — called BEFORE a Supabase client
 * is constructed or any table is read. This is what stops a cross-wired
 * `LEGACY_SUPABASE_URL` (e.g. --project=bossa-ai-os pointed at Bossa Asado i
 * Mar's URL, or vice versa) from ever reaching a live read: the allow-listed
 * table set for the WRONG project would otherwise be silently queried
 * against the wrong database.
 */
export function assertProjectRefMatches(project: LegacyProjectKey, actualProjectRef: string): void {
  const expected = LEGACY_PROJECT_SPECS[project].expectedProjectRef;
  if (actualProjectRef !== expected) {
    throw new Error(
      `Refusing to read from project ref "${actualProjectRef}": --project=${project} is only ever allowed to read from "${expected}". ` +
        `Check that LEGACY_SUPABASE_URL actually points at the intended project before re-running.`,
    );
  }
}

/** UTC-timestamp + random-id run identifier — unique per invocation. Takes the timestamp and random id as arguments (rather than calling Date.now()/crypto.randomUUID() itself) purely so it's deterministically testable. */
export function buildRunId(timestamp: Date, randomId: string): string {
  const compact = timestamp.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return `${compact}-${randomId}`;
}

/** True only when both arrays contain exactly the same members, order-independent — the manifest-completeness gate for "every required dataset actually completed, nothing more, nothing less." */
export function datasetsMatch(required: readonly string[], completed: readonly string[]): boolean {
  if (required.length !== completed.length) return false;
  const req = [...required].sort();
  const comp = [...completed].sort();
  return req.every((value, index) => value === comp[index]);
}

export interface ManifestEntry {
  dataset: string;
  rowCount: number;
  /** Checksum of the row data alone (stable across identical reruns — excludes exportedAt). */
  dataChecksumSha256: string;
  /** Checksum of the actual file content written to disk (includes exportedAt and other envelope fields). */
  fileChecksumSha256: string;
  destinationDecision: string;
}

const DEFAULT_DESTINATION_DECISION =
  "pending reconciliation — see docs/PRODUCTION_DEPLOYMENT.md § Legacy Preservation Gate";

export function buildManifestEntry(params: {
  dataset: string;
  rowCount: number;
  dataChecksumSha256: string;
  fileChecksumSha256: string;
  destinationDecision?: string;
}): ManifestEntry {
  return {
    dataset: params.dataset,
    rowCount: params.rowCount,
    dataChecksumSha256: params.dataChecksumSha256,
    fileChecksumSha256: params.fileChecksumSha256,
    destinationDecision: params.destinationDecision ?? DEFAULT_DESTINATION_DECISION,
  };
}

export interface ExportManifest {
  runId: string;
  status: "completed" | "failed";
  project: LegacyProjectKey;
  sourceProjectRef: string;
  generatedAt: string;
  requiredDatasets: string[];
  completedDatasets: string[];
  entries: ManifestEntry[];
  failures: Array<{ dataset: string; error: string }>;
}

/**
 * Builds the final manifest object. Deliberately the ONLY place that decides
 * `status` — "completed" only when there are zero failures AND
 * `completedDatasets` exactly matches `requiredDatasets` (every required
 * dataset present, nothing extra, nothing missing). Any other combination —
 * a failure recorded, a dataset silently skipped, an unexpected extra
 * dataset — is "failed". There is no partially-completed status, so a
 * caller can never mistake a partial run for a clean one.
 */
export function buildExportManifest(params: {
  runId: string;
  project: LegacyProjectKey;
  sourceProjectRef: string;
  generatedAt: string;
  requiredDatasets: string[];
  completedDatasets: string[];
  entries: ManifestEntry[];
  failures: Array<{ dataset: string; error: string }>;
}): ExportManifest {
  const isComplete = params.failures.length === 0 && datasetsMatch(params.requiredDatasets, params.completedDatasets);
  return {
    runId: params.runId,
    status: isComplete ? "completed" : "failed",
    project: params.project,
    sourceProjectRef: params.sourceProjectRef,
    generatedAt: params.generatedAt,
    requiredDatasets: params.requiredDatasets,
    completedDatasets: params.completedDatasets,
    entries: params.entries,
    failures: params.failures,
  };
}

/**
 * Validates a fully-paginated row set against the table's own authoritative
 * exact count and rejects any duplicate id seen across pages — the two
 * completeness guarantees pagination alone can't provide (a page boundary
 * landing exactly on a duplicate/missing row would otherwise silently
 * under- or over-count). Called after every page of a single read has been
 * fetched — a failure here means "this one read is wrong," which is why the
 * source-stability check in legacy-export-io.ts runs this on each of its
 * two passes independently, before ever comparing them to each other.
 */
export function validateTableCompleteness(rows: ReadonlyArray<{ id: unknown }>, expectedCount: number, table: string): void {
  if (rows.length !== expectedCount) {
    throw new Error(`Row count mismatch for "${table}": downloaded ${rows.length}, but the database reports ${expectedCount}`);
  }
  const seen = new Set<unknown>();
  for (const row of rows) {
    if (seen.has(row.id)) {
      throw new Error(`Duplicate id "${String(row.id)}" encountered across pages while exporting "${table}"`);
    }
    seen.add(row.id);
  }
}

/**
 * Resolves `segments` under `baseDir` and throws if the result would escape
 * `baseDir` (e.g. via a "../" segment) — defense in depth for the export
 * tool's file-writing path, even though every segment it's actually called
 * with today comes from the fixed allow-lists above or a generated run id,
 * never CLI or table-name input directly.
 */
export function safeJoin(baseDir: string, ...segments: string[]): string {
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(resolvedBase, ...segments);
  const relative = path.relative(resolvedBase, resolvedTarget);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to write outside "${resolvedBase}": resolved path was "${resolvedTarget}"`);
  }
  return resolvedTarget;
}
