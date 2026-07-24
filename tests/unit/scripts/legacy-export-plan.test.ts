import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertProjectRefMatches,
  buildExportManifest,
  buildManifestEntry,
  buildRunId,
  computeDataChecksum,
  datasetsMatch,
  describeExportPlan,
  extractProjectRefFromUrl,
  LEGACY_PROJECT_SPECS,
  parseArgs,
  requiredDatasetsFor,
  safeJoin,
  sha256Hex,
  stableStringify,
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

    it("requiredDatasetsFor includes auth-identities only when the project has real auth users to export", () => {
      expect(requiredDatasetsFor("bossa-ai-os")).toEqual(["campaigns", "weekly_briefs", "kpi_daily", "decision_log", "auth-identities"]);
      expect(requiredDatasetsFor("bossa-asado-i-mar")).toEqual(["bossa_leads"]);
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

    it("stableStringify produces identical output regardless of object key insertion order", () => {
      const a = { id: 1, name: "synthetic", nested: { z: 1, a: 2 } };
      const b = { nested: { a: 2, z: 1 }, name: "synthetic", id: 1 };
      expect(stableStringify(a)).toBe(stableStringify(b));
    });

    it("stableStringify sorts keys within array elements too", () => {
      const rows1 = [{ b: 2, a: 1 }];
      const rows2 = [{ a: 1, b: 2 }];
      expect(stableStringify(rows1)).toBe(stableStringify(rows2));
    });

    it("computeDataChecksum is identical for the same rows regardless of key order", () => {
      const rows1 = [{ id: 1, value: "x" }];
      const rows2 = [{ value: "x", id: 1 }];
      expect(computeDataChecksum(rows1)).toBe(computeDataChecksum(rows2));
    });

    it("computeDataChecksum differs when the actual row content differs", () => {
      expect(computeDataChecksum([{ id: 1 }])).not.toBe(computeDataChecksum([{ id: 2 }]));
    });

    it("extractProjectRefFromUrl parses the ref out of a real-shaped Supabase URL", () => {
      expect(extractProjectRefFromUrl("https://oqmftkttkfktyzefswpz.supabase.co")).toBe("oqmftkttkfktyzefswpz");
      expect(extractProjectRefFromUrl("https://zgfncoexiqnqeqaxpqdy.supabase.co")).toBe("zgfncoexiqnqeqaxpqdy");
    });

    it("extractProjectRefFromUrl throws on an unrecognized URL shape rather than guessing", () => {
      expect(() => extractProjectRefFromUrl("https://example.com")).toThrow();
    });
  });

  describe("buildRunId", () => {
    it("combines a compact UTC timestamp with the given random id", () => {
      const runId = buildRunId(new Date("2026-07-23T15:30:00.123Z"), "synthetic-uuid-0000");
      expect(runId).toBe("20260723T153000Z-synthetic-uuid-0000");
    });

    it("produces different ids for different timestamps given the same random id", () => {
      const a = buildRunId(new Date("2026-07-23T15:30:00.000Z"), "same-uuid");
      const b = buildRunId(new Date("2026-07-23T15:30:01.000Z"), "same-uuid");
      expect(a).not.toBe(b);
    });
  });

  describe("datasetsMatch", () => {
    it("is true for the same sets regardless of order", () => {
      expect(datasetsMatch(["a", "b", "c"], ["c", "a", "b"])).toBe(true);
    });

    it("is false when a required dataset is missing", () => {
      expect(datasetsMatch(["a", "b", "c"], ["a", "b"])).toBe(false);
    });

    it("is false when there's an extra, unrequested dataset", () => {
      expect(datasetsMatch(["a", "b"], ["a", "b", "c"])).toBe(false);
    });

    it("is true for two empty arrays", () => {
      expect(datasetsMatch([], [])).toBe(true);
    });
  });

  describe("manifest generation", () => {
    it("buildManifestEntry fills in a default pending-reconciliation destination when none is given", () => {
      const entry = buildManifestEntry({
        dataset: "synthetic_table",
        rowCount: 3,
        dataChecksumSha256: "abc",
        fileChecksumSha256: "def",
      });
      expect(entry.destinationDecision).toMatch(/pending reconciliation/i);
    });

    it("buildManifestEntry preserves an explicitly given destination decision", () => {
      const entry = buildManifestEntry({
        dataset: "synthetic_table",
        rowCount: 3,
        dataChecksumSha256: "abc",
        fileChecksumSha256: "def",
        destinationDecision: "reconciled into public.leads on 2026-02-01",
      });
      expect(entry.destinationDecision).toBe("reconciled into public.leads on 2026-02-01");
    });

    it("buildManifestEntry records every required field", () => {
      const entry = buildManifestEntry({
        dataset: "synthetic_table",
        rowCount: 8,
        dataChecksumSha256: "abc",
        fileChecksumSha256: "def",
      });
      expect(entry).toMatchObject({ dataset: "synthetic_table", rowCount: 8, dataChecksumSha256: "abc", fileChecksumSha256: "def" });
    });
  });

  describe("buildExportManifest completeness rule", () => {
    const baseParams = {
      runId: "20260101T000000Z-synthetic",
      project: "bossa-ai-os" as const,
      sourceProjectRef: "oqmftkttkfktyzefswpz",
      generatedAt: "2026-01-01T00:00:00.000Z",
    };

    it("is 'completed' only when there are zero failures and completedDatasets exactly matches requiredDatasets", () => {
      const manifest = buildExportManifest({
        ...baseParams,
        requiredDatasets: ["campaigns", "weekly_briefs"],
        completedDatasets: ["weekly_briefs", "campaigns"],
        entries: [buildManifestEntry({ dataset: "campaigns", rowCount: 3, dataChecksumSha256: "a", fileChecksumSha256: "b" })],
        failures: [],
      });
      expect(manifest.status).toBe("completed");
    });

    it("is 'failed' when even one dataset failed, regardless of how many succeeded", () => {
      const manifest = buildExportManifest({
        ...baseParams,
        requiredDatasets: ["campaigns", "kpi_daily"],
        completedDatasets: ["campaigns"],
        entries: [buildManifestEntry({ dataset: "campaigns", rowCount: 3, dataChecksumSha256: "a", fileChecksumSha256: "b" })],
        failures: [{ dataset: "kpi_daily", error: "synthetic row-count mismatch" }],
      });
      expect(manifest.status).toBe("failed");
    });

    it("is 'failed' with zero successful entries when every dataset fails", () => {
      const manifest = buildExportManifest({
        ...baseParams,
        project: "bossa-asado-i-mar",
        sourceProjectRef: "zgfncoexiqnqeqaxpqdy",
        requiredDatasets: ["bossa_leads"],
        completedDatasets: [],
        entries: [],
        failures: [{ dataset: "bossa_leads", error: "synthetic failure" }],
      });
      expect(manifest.status).toBe("failed");
      expect(manifest.entries).toHaveLength(0);
    });

    it("is 'failed' when completedDatasets has an unexpected dataset not in requiredDatasets, even with zero explicit failures", () => {
      const manifest = buildExportManifest({
        ...baseParams,
        requiredDatasets: ["campaigns"],
        completedDatasets: ["campaigns", "an_unexpected_extra_dataset"],
        entries: [],
        failures: [],
      });
      expect(manifest.status).toBe("failed");
    });

    it("carries runId, requiredDatasets, and completedDatasets through unchanged", () => {
      const manifest = buildExportManifest({
        ...baseParams,
        requiredDatasets: ["campaigns", "kpi_daily"],
        completedDatasets: ["campaigns", "kpi_daily"],
        entries: [],
        failures: [],
      });
      expect(manifest.runId).toBe(baseParams.runId);
      expect(manifest.requiredDatasets).toEqual(["campaigns", "kpi_daily"]);
      expect(manifest.completedDatasets).toEqual(["campaigns", "kpi_daily"]);
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
