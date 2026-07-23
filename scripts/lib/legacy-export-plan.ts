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
    tables: ["campaigns", "weekly_briefs", "kpi_daily", "decision_log"],
    includeAuthIdentities: true,
  },
  "bossa-asado-i-mar": {
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
