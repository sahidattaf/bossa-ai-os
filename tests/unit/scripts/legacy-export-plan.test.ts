import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildManifestEntry,
  describeExportPlan,
  extractProjectRefFromUrl,
  LEGACY_PROJECT_SPECS,
  parseArgs,
  safeJoin,
  sha256Hex,
} from "@/scripts/lib/legacy-export-plan";

describe("legacy-export-plan (pure logic only — no Supabase I/O, no real data)", () => {
  describe("allow-list", () => {
    it("bossa-ai-os only allow-lists its four verified non-empty legacy tables, plus auth identities", () => {
      expect(LEGACY_PROJECT_SPECS["bossa-ai-os"]).toEqual({
        tables: ["campaigns", "weekly_briefs", "kpi_daily", "decision_log"],
        includeAuthIdentities: true,
      });
    });

    it("bossa-asado-i-mar only allow-lists bossa_leads, with no auth identities to export", () => {
      expect(LEGACY_PROJECT_SPECS["bossa-asado-i-mar"]).toEqual({
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
