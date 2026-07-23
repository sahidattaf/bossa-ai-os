import path from "node:path";

import { describe, expect, it } from "vitest";

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
} from "@/scripts/lib/legacy-export-plan";

describe("legacy-export-plan (pure logic only — no Supabase I/O, no real data)", () => {
  describe("allow-list", () => {
    it("bossa-ai-os only allow-lists its four verified non-empty legacy tables, plus auth identities", () => {
      expect(LEGACY_PROJECT_SPECS["bossa-ai-os"]).toEqual({
        expectedProjectRef: "oqmftkttkfktyzefswpz",
        tables: ["campaigns", "weekly_briefs", "kpi_daily", "decision_log"],
        includeAuthIdentities: true,
      });
    });

    it("bossa-asado-i-mar only allow-lists bossa_leads, with no auth identities to export", () => {
      expect(LEGACY_PROJECT_SPECS["bossa-asado-i-mar"]).toEqual({
        expectedProjectRef: "zgfncoexiqnqeqaxpqdy",
        tables: ["bossa_leads"],
        includeAuthIdentities: false,
      });
    });

    it("parseArgs only accepts a recognized --project value, never an arbitrary string", () => {
      expect(parseArgs(["--project=bossa-ai-os"]).project).toBe("bossa-ai-os");
      expect(parseArgs(["--project=some-other-legacy-project"]).project).toBeUndefined();
    });

    it("parseArgs defaults to no project, the default out dir, and confirm=false", () => {
      expect(parseArgs([])).toEqual({ outDir: ".legacy-exports", confirm: false });
    });

    it("parseArgs reads --out and --confirm", () => {
      expect(parseArgs(["--project=bossa-ai-os", "--out=/tmp/custom-exports", "--confirm"])).toEqual({
        project: "bossa-ai-os",
        outDir: "/tmp/custom-exports",
        confirm: true,
      });
    });

    it("describeExportPlan only ever mentions allow-listed tables for the requested project", () => {
      const lines = describeExportPlan("bossa-asado-i-mar");
      expect(lines.some((line) => line.includes("bossa_leads"))).toBe(true);
      expect(lines.some((line) => line.includes("campaigns"))).toBe(false);
      expect(lines.some((line) => line.includes("no auth users to export"))).toBe(true);
    });
  });

  describe("project-ref binding (fail closed before any read)", () => {
    it("accepts bossa-ai-os paired with its own expected ref", () => {
      expect(() => assertProjectRefMatches("bossa-ai-os", "oqmftkttkfktyzefswpz")).not.toThrow();
    });

    it("accepts bossa-asado-i-mar paired with its own expected ref", () => {
      expect(() => assertProjectRefMatches("bossa-asado-i-mar", "zgfncoexiqnqeqaxpqdy")).not.toThrow();
    });

    it("rejects bossa-ai-os cross-wired to Bossa Asado i Mar's ref", () => {
      expect(() => assertProjectRefMatches("bossa-ai-os", "zgfncoexiqnqeqaxpqdy")).toThrow(/refusing to read/i);
    });

    it("rejects bossa-asado-i-mar cross-wired to bossa-ai-os's ref", () => {
      expect(() => assertProjectRefMatches("bossa-asado-i-mar", "oqmftkttkfktyzefswpz")).toThrow(/refusing to read/i);
    });

    it("rejects a completely unrecognized ref for either project", () => {
      expect(() => assertProjectRefMatches("bossa-ai-os", "some-other-unrelated-project")).toThrow(/refusing to read/i);
    });
  });

  describe("checksum logic", () => {
    it("sha256Hex is deterministic for identical content", () => {
      const content = JSON.stringify({ rows: [{ id: 1 }, { id: 2 }] });
      expect(sha256Hex(content)).toBe(sha256Hex(content));
    });

    it("sha256Hex differs for different content", () => {
      expect(sha256Hex("a")).not.toBe(sha256Hex("b"));
    });

    it("sha256Hex produces a 64-character lowercase hex digest", () => {
      expect(sha256Hex("synthetic-test-content")).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe("manifest generation", () => {
    it("buildManifestEntry fills in a default pending-reconciliation destination when none is given", () => {
      const entry = buildManifestEntry({
        sourceProjectRef: "synthetic-ref",
        table: "synthetic_table",
        exportedAt: "2026-01-01T00:00:00.000Z",
        rowCount: 3,
        checksumSha256: "deadbeef",
      });
      expect(entry.destinationDecision).toMatch(/pending reconciliation/i);
    });

    it("buildManifestEntry preserves an explicitly given destination decision", () => {
      const entry = buildManifestEntry({
        sourceProjectRef: "synthetic-ref",
        table: "synthetic_table",
        exportedAt: "2026-01-01T00:00:00.000Z",
        rowCount: 3,
        checksumSha256: "deadbeef",
        destinationDecision: "reconciled into public.leads on 2026-02-01",
      });
      expect(entry.destinationDecision).toBe("reconciled into public.leads on 2026-02-01");
    });

    it("buildManifestEntry records every required field: source ref, table, timestamp, row count, checksum", () => {
      const entry = buildManifestEntry({
        sourceProjectRef: "synthetic-ref",
        table: "synthetic_table",
        exportedAt: "2026-01-01T00:00:00.000Z",
        rowCount: 8,
        checksumSha256: "deadbeef",
      });
      expect(entry).toMatchObject({
        sourceProjectRef: "synthetic-ref",
        table: "synthetic_table",
        exportedAt: "2026-01-01T00:00:00.000Z",
        rowCount: 8,
        checksumSha256: "deadbeef",
      });
    });

    it("extractProjectRefFromUrl parses the ref out of a real-shaped Supabase URL", () => {
      expect(extractProjectRefFromUrl("https://oqmftkttkfktyzefswpz.supabase.co")).toBe("oqmftkttkfktyzefswpz");
      expect(extractProjectRefFromUrl("https://zgfncoexiqnqeqaxpqdy.supabase.co")).toBe("zgfncoexiqnqeqaxpqdy");
    });

    it("extractProjectRefFromUrl throws on an unrecognized URL shape rather than guessing", () => {
      expect(() => extractProjectRefFromUrl("https://example.com")).toThrow();
    });
  });

  describe("buildExportManifest status", () => {
    it("is 'completed' only when there are zero failures", () => {
      const manifest = buildExportManifest({
        project: "bossa-ai-os",
        sourceProjectRef: "oqmftkttkfktyzefswpz",
        generatedAt: "2026-01-01T00:00:00.000Z",
        entries: [
          buildManifestEntry({ sourceProjectRef: "oqmftkttkfktyzefswpz", table: "campaigns", exportedAt: "2026-01-01T00:00:00.000Z", rowCount: 3, checksumSha256: "abc" }),
        ],
        failures: [],
      });
      expect(manifest.status).toBe("completed");
    });

    it("is 'failed' when even one dataset failed, regardless of how many succeeded", () => {
      const manifest = buildExportManifest({
        project: "bossa-ai-os",
        sourceProjectRef: "oqmftkttkfktyzefswpz",
        generatedAt: "2026-01-01T00:00:00.000Z",
        entries: [
          buildManifestEntry({ sourceProjectRef: "oqmftkttkfktyzefswpz", table: "campaigns", exportedAt: "2026-01-01T00:00:00.000Z", rowCount: 3, checksumSha256: "abc" }),
        ],
        failures: [{ table: "kpi_daily", error: "synthetic row-count mismatch" }],
      });
      expect(manifest.status).toBe("failed");
    });

    it("is 'failed' with zero successful entries when every dataset fails", () => {
      const manifest = buildExportManifest({
        project: "bossa-asado-i-mar",
        sourceProjectRef: "zgfncoexiqnqeqaxpqdy",
        generatedAt: "2026-01-01T00:00:00.000Z",
        entries: [],
        failures: [{ table: "bossa_leads", error: "synthetic failure" }],
      });
      expect(manifest.status).toBe("failed");
      expect(manifest.entries).toHaveLength(0);
    });
  });

  describe("table completeness validation (pagination/count/duplicates)", () => {
    it("passes when the downloaded row count exactly matches the database's exact count and every id is unique", () => {
      const rows = [{ id: 1 }, { id: 2 }, { id: 3 }];
      expect(() => validateTableCompleteness(rows, 3, "synthetic_table")).not.toThrow();
    });

    it("throws when downloaded rows are fewer than the exact count (a page was silently dropped)", () => {
      const rows = [{ id: 1 }, { id: 2 }];
      expect(() => validateTableCompleteness(rows, 3, "synthetic_table")).toThrow(/row count mismatch/i);
    });

    it("throws when downloaded rows exceed the exact count (something changed mid-pagination)", () => {
      const rows = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
      expect(() => validateTableCompleteness(rows, 3, "synthetic_table")).toThrow(/row count mismatch/i);
    });

    it("throws on a duplicate id across pages even when the total count happens to match", () => {
      const rows = [{ id: 1 }, { id: 2 }, { id: 2 }];
      expect(() => validateTableCompleteness(rows, 3, "synthetic_table")).toThrow(/duplicate id/i);
    });

    it("passes for a table with zero rows and a zero exact count", () => {
      expect(() => validateTableCompleteness([], 0, "synthetic_empty_table")).not.toThrow();
    });
  });

  describe("path safety", () => {
    it("safeJoin resolves a normal, in-bounds path", () => {
      const result = safeJoin("/tmp/exports", "bossa-ai-os", "campaigns.json");
      expect(result.endsWith(path.join("bossa-ai-os", "campaigns.json"))).toBe(true);
    });

    it("safeJoin refuses a path that would escape the base directory via traversal", () => {
      expect(() => safeJoin("/tmp/exports", "..", "..", "etc", "passwd")).toThrow(/refusing to write outside/i);
    });

    it("safeJoin refuses an absolute-path segment that would replace the base directory", () => {
      expect(() => safeJoin("/tmp/exports", "/etc/passwd")).toThrow(/refusing to write outside/i);
    });
  });
});
