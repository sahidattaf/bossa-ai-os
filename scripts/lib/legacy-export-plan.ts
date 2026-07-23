/**
 * Pure planning logic for scripts/export-legacy-supabase-data.ts, kept in
 * its own module (no Supabase client, no filesystem I/O) so it can be
 * unit-tested without touching a real project or writing real files. See
 * that script's header comment and docs/PRODUCTION_DEPLOYMENT.md's "Legacy
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
    lines.push(`${project}: read-only export of "${table}" (row count + full rows + a SHA-256 checksum, no writes)`);
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

export interface ManifestEntry {
  sourceProjectRef: string;
  table: string;
  exportedAt: string;
  rowCount: number;
  checksumSha256: string;
  destinationDecision: string;
}

const DEFAULT_DESTINATION_DECISION =
  "pending reconciliation — see docs/PRODUCTION_DEPLOYMENT.md § Legacy Preservation Gate";

export function buildManifestEntry(params: {
  sourceProjectRef: string;
  table: string;
  exportedAt: string;
  rowCount: number;
  checksumSha256: string;
  destinationDecision?: string;
}): ManifestEntry {
  return {
    sourceProjectRef: params.sourceProjectRef,
    table: params.table,
    exportedAt: params.exportedAt,
    rowCount: params.rowCount,
    checksumSha256: params.checksumSha256,
    destinationDecision: params.destinationDecision ?? DEFAULT_DESTINATION_DECISION,
  };
}

export interface ExportManifest {
  status: "completed" | "failed";
  project: LegacyProjectKey;
  sourceProjectRef: string;
  generatedAt: string;
  entries: ManifestEntry[];
  failures: Array<{ table: string; error: string }>;
}

/**
 * Builds the final manifest object. Deliberately the ONLY place that decides
 * `status` — "completed" only when every requested dataset succeeded and
 * there are zero failures, "failed" otherwise. A partial success (some
 * tables ok, one not) is still reported as "failed": there is no
 * partially-completed status, so a caller can never mistake a failed run
 * for a clean one by only checking `entries.length > 0`.
 */
export function buildExportManifest(params: {
  project: LegacyProjectKey;
  sourceProjectRef: string;
  generatedAt: string;
  entries: ManifestEntry[];
  failures: Array<{ table: string; error: string }>;
}): ExportManifest {
  return {
    status: params.failures.length === 0 ? "completed" : "failed",
    project: params.project,
    sourceProjectRef: params.sourceProjectRef,
    generatedAt: params.generatedAt,
    entries: params.entries,
    failures: params.failures,
  };
}

/**
 * Validates a fully-paginated row set against the table's own authoritative
 * exact count and rejects any duplicate id seen across pages — the two
 * completeness guarantees pagination alone can't provide (a page boundary
 * landing exactly on a duplicate/missing row would otherwise silently
 * under- or over-count). Called only after every page has been fetched, so
 * a failure here means "the fully-assembled export is wrong," not "one page
 * was wrong" — the caller must not write any file for this table if this
 * throws.
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
 * with today comes from the fixed allow-lists above, never CLI or table-name
 * input directly.
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
