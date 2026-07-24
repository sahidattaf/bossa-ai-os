import { mkdtemp, readdir, readFile as nodeReadFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createNodeFileSystemPort } from "@/scripts/lib/legacy-export-adapters";
import {
  fetchAuthIdentitiesStable,
  fetchTableStable,
  publishRun,
  type AuthIdentityReader,
  type FileSystemPort,
  type LegacyTableReader,
  type PreparedFile,
  type RawLegacyAuthUser,
} from "@/scripts/lib/legacy-export-io";
import { buildExportManifest, buildManifestEntry, buildRunId, computeDataChecksum, sha256Hex, type ExportManifest } from "@/scripts/lib/legacy-export-plan";

/** A hand-written fake LegacyTableReader — returns one fixed page-set per call, in call order, so tests can simulate "the data changed between two reads" deterministically without any real network or database. */
function fakeTableReader(callResults: Array<{ exactCount: number; pages: Array<Array<{ id: number; [key: string]: unknown }>> }>): LegacyTableReader {
  let call = 0;
  return {
    async getExactCount() {
      return callResults[Math.min(call, callResults.length - 1)]!.exactCount;
    },
    async getPage(_table, offset, limit) {
      const result = callResults[Math.min(call, callResults.length - 1)]!;
      const pageIndex = Math.floor(offset / limit);
      const page = result.pages[pageIndex] ?? [];
      if (pageIndex === result.pages.length - 1) call += 1;
      return page;
    },
  };
}

function fakeAuthReader(callResults: RawLegacyAuthUser[][]): AuthIdentityReader {
  let call = 0;
  return {
    async listUsersPage(page) {
      const users = callResults[Math.min(call, callResults.length - 1)]!;
      if (page === 1 && callResults.length > 1) call += 1;
      return { users: page === 1 ? users : [] };
    },
  };
}

describe("legacy-export-io: source-stability checks (fake readers, no filesystem)", () => {
  describe("fetchTableStable", () => {
    it("passes when two independent reads agree", async () => {
      const rows = [{ id: 1 }, { id: 2 }, { id: 3 }];
      const reader = fakeTableReader([
        { exactCount: 3, pages: [rows] },
        { exactCount: 3, pages: [rows] },
      ]);
      const result = await fetchTableStable(reader, "synthetic_table", 500);
      expect(result.rows).toEqual(rows);
      expect(result.exactCount).toBe(3);
    });

    it("fails when the row content changes between the two passes despite matching counts", async () => {
      const reader = fakeTableReader([
        { exactCount: 2, pages: [[{ id: 1 }, { id: 2 }]] },
        { exactCount: 2, pages: [[{ id: 1 }, { id: 2, changed: true }]] },
      ]);
      await expect(fetchTableStable(reader, "synthetic_table", 500)).rejects.toThrow(/changed during export/i);
    });

    it("fails when the exact count differs between the two passes", async () => {
      const reader = fakeTableReader([
        { exactCount: 2, pages: [[{ id: 1 }, { id: 2 }]] },
        { exactCount: 3, pages: [[{ id: 1 }, { id: 2 }, { id: 3 }]] },
      ]);
      await expect(fetchTableStable(reader, "synthetic_table", 500)).rejects.toThrow(/changed during export/i);
    });

    it("fails on a count mismatch within a single pass, before ever comparing to the second pass", async () => {
      const reader = fakeTableReader([{ exactCount: 5, pages: [[{ id: 1 }, { id: 2 }]] }]);
      await expect(fetchTableStable(reader, "synthetic_table", 500)).rejects.toThrow(/row count mismatch/i);
    });

    it("fails on a duplicate id across pages within a single pass", async () => {
      const reader = fakeTableReader([{ exactCount: 3, pages: [[{ id: 1 }, { id: 2 }], [{ id: 2 }]] }]);
      await expect(fetchTableStable(reader, "synthetic_table", 2)).rejects.toThrow(/duplicate id/i);
    });

    it("paginates across multiple pages and reassembles every row", async () => {
      const page1 = Array.from({ length: 500 }, (_, i) => ({ id: i + 1 }));
      const page2 = Array.from({ length: 10 }, (_, i) => ({ id: i + 501 }));
      const allRows = [...page1, ...page2];
      const reader = fakeTableReader([
        { exactCount: 510, pages: [page1, page2] },
        { exactCount: 510, pages: [page1, page2] },
      ]);
      const result = await fetchTableStable(reader, "synthetic_table", 500);
      expect(result.rows).toHaveLength(510);
      expect(result.rows).toEqual(allRows);
    });
  });

  describe("fetchAuthIdentitiesStable", () => {
    function user(id: string): RawLegacyAuthUser {
      return { id, email: `${id}@example.test`, created_at: "2026-01-01T00:00:00.000Z" };
    }

    it("passes and sorts by id when two independent reads agree (regardless of source order)", async () => {
      const reader = fakeAuthReader([
        [user("c"), user("a"), user("b")],
        [user("c"), user("a"), user("b")],
      ]);
      const identities = await fetchAuthIdentitiesStable(reader);
      expect(identities.map((i) => i.id)).toEqual(["a", "b", "c"]);
    });

    it("fails when identities change between the two passes", async () => {
      const reader = fakeAuthReader([[user("a")], [user("a"), user("b")]]);
      await expect(fetchAuthIdentitiesStable(reader)).rejects.toThrow(/changed during export/i);
    });

    it("has no artificial page cap — pages until GoTrue returns a short page, even past 20 pages", async () => {
      let requestedPages = 0;
      const perPage = 200;
      const totalPages = 25; // deliberately more than the old fixed 20-page cap
      const reader: AuthIdentityReader = {
        async listUsersPage(page) {
          requestedPages = Math.max(requestedPages, page);
          if (page > totalPages) return { users: [] };
          const isLast = page === totalPages;
          const count = isLast ? 1 : perPage;
          return { users: Array.from({ length: count }, (_, i) => user(`page${page}-${i}`)) };
        },
      };
      const identities = await fetchAuthIdentitiesStable(reader);
      expect(requestedPages).toBeGreaterThanOrEqual(totalPages);
      expect(identities.length).toBe((totalPages - 1) * perPage + 1);
    });
  });
});

describe("legacy-export-io: publishRun (real temporary filesystem)", () => {
  let tempRoot: string;
  let fs: FileSystemPort;
  let projectDir: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), "legacy-export-io-test-"));
    fs = createNodeFileSystemPort();
    projectDir = path.join(tempRoot, "bossa-ai-os");
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  function withOverrides(base: FileSystemPort, overrides: Partial<FileSystemPort>): FileSystemPort {
    return { ...base, ...overrides };
  }

  function makeFile(relativePath: string, content: string): PreparedFile {
    return { relativePath, content, expectedFileChecksumSha256: sha256Hex(content) };
  }

  function makeManifest(runId: string, overrides: Partial<ExportManifest> = {}): ExportManifest {
    return buildExportManifest({
      runId,
      project: "bossa-ai-os",
      sourceProjectRef: "oqmftkttkfktyzefswpz",
      generatedAt: "2026-01-01T00:00:00.000Z",
      requiredDatasets: ["campaigns"],
      completedDatasets: ["campaigns"],
      entries: [buildManifestEntry({ dataset: "campaigns", rowCount: 3, dataChecksumSha256: computeDataChecksum([{ id: 1 }]), fileChecksumSha256: "irrelevant-for-these-tests" })],
      failures: [],
      ...overrides,
    });
  }

  it("a successful run creates a completed run directory containing every file and the manifest", async () => {
    const runId = buildRunId(new Date("2026-01-01T00:00:00.000Z"), "run-a");
    const file = makeFile("campaigns.json", JSON.stringify({ rows: [{ id: 1 }] }));
    const manifest = makeManifest(runId);

    const { publishedPath } = await publishRun(fs, { projectDir, runId, files: [file], manifest });

    expect(publishedPath).toBe(path.join(projectDir, runId));
    const entries = await readdir(publishedPath);
    expect(entries.sort()).toEqual(["campaigns.json", "manifest.json"]);

    const writtenManifest = JSON.parse(await nodeReadFile(path.join(publishedPath, "manifest.json"), "utf8"));
    expect(writtenManifest.status).toBe("completed");
    expect(writtenManifest.completedDatasets).toEqual(writtenManifest.requiredDatasets);
  });

  it("written-file checksums are recalculated and verified before publication — a corrupted write is caught", async () => {
    const runId = buildRunId(new Date("2026-01-01T00:00:00.000Z"), "run-corrupt");
    const file = makeFile("campaigns.json", JSON.stringify({ rows: [{ id: 1 }] }));
    const manifest = makeManifest(runId);

    const corruptingFs = withOverrides(fs, {
      readFile: async (targetPath: string) => {
        const real = await fs.readFile(targetPath);
        return targetPath.endsWith("campaigns.json") ? `${real}-TAMPERED` : real;
      },
    });

    await expect(publishRun(corruptingFs, { projectDir, runId, files: [file], manifest })).rejects.toThrow(/checksum verification failed/i);

    const completedDir = path.join(projectDir, runId);
    await expect(nodeReadFile(path.join(completedDir, "manifest.json"), "utf8")).rejects.toThrow();

    const failedDir = path.join(projectDir, `${runId}-failed`);
    const failedEntries = await readdir(failedDir);
    expect(failedEntries).toEqual(["manifest.json"]);
    const failedManifest = JSON.parse(await nodeReadFile(path.join(failedDir, "manifest.json"), "utf8"));
    expect(failedManifest.status).toBe("failed");
  });

  it("a partial write never creates a completed run directory", async () => {
    const runId = buildRunId(new Date("2026-01-01T00:00:00.000Z"), "run-partial");
    const fileA = makeFile("campaigns.json", "content-a");
    const fileB = makeFile("weekly_briefs.json", "content-b");
    const manifest = makeManifest(runId, { requiredDatasets: ["campaigns", "weekly_briefs"], completedDatasets: ["campaigns", "weekly_briefs"] });

    let writeCount = 0;
    const failingFs = withOverrides(fs, {
      writeFile: async (targetPath: string, content: string) => {
        writeCount += 1;
        if (writeCount === 2) throw new Error("synthetic disk failure mid-write");
        return fs.writeFile(targetPath, content);
      },
    });

    await expect(publishRun(failingFs, { projectDir, runId, files: [fileA, fileB], manifest })).rejects.toThrow(/synthetic disk failure/i);

    await expect(readdir(path.join(projectDir, runId))).rejects.toThrow();
    const failedEntries = await readdir(path.join(projectDir, `${runId}-failed`));
    expect(failedEntries).toEqual(["manifest.json"]);
  });

  it("a rename failure is caught and converted into a failed-run record, never a completed directory", async () => {
    const runId = buildRunId(new Date("2026-01-01T00:00:00.000Z"), "run-rename-fail");
    const file = makeFile("campaigns.json", "content");
    const manifest = makeManifest(runId);

    const failingFs = withOverrides(fs, {
      rename: async (oldPath: string, newPath: string) => {
        if (!newPath.endsWith("-failed")) {
          throw new Error("synthetic rename failure");
        }
        return fs.rename(oldPath, newPath);
      },
    });

    await expect(publishRun(failingFs, { projectDir, runId, files: [file], manifest })).rejects.toThrow(/synthetic rename failure/i);

    await expect(readdir(path.join(projectDir, runId))).rejects.toThrow();
    const failedEntries = await readdir(path.join(projectDir, `${runId}-failed`));
    expect(failedEntries).toEqual(["manifest.json"]);
  });

  it("a prior completed export remains byte-for-byte untouched when a later run fails", async () => {
    const runIdA = buildRunId(new Date("2026-01-01T00:00:00.000Z"), "run-prior-ok");
    const fileA = makeFile("campaigns.json", "original-content");
    const manifestA = makeManifest(runIdA);
    const { publishedPath: publishedA } = await publishRun(fs, { projectDir, runId: runIdA, files: [fileA], manifest: manifestA });
    const originalCampaigns = await nodeReadFile(path.join(publishedA, "campaigns.json"), "utf8");
    const originalManifest = await nodeReadFile(path.join(publishedA, "manifest.json"), "utf8");

    const runIdB = buildRunId(new Date("2026-01-02T00:00:00.000Z"), "run-later-fail");
    const fileB = makeFile("campaigns.json", "content");
    const failingFs = withOverrides(fs, {
      writeFile: async () => {
        throw new Error("synthetic failure for run B");
      },
    });
    await expect(publishRun(failingFs, { projectDir, runId: runIdB, files: [fileB], manifest: makeManifest(runIdB) })).rejects.toThrow(/synthetic failure for run b/i);

    expect(await nodeReadFile(path.join(publishedA, "campaigns.json"), "utf8")).toBe(originalCampaigns);
    expect(await nodeReadFile(path.join(publishedA, "manifest.json"), "utf8")).toBe(originalManifest);
  });

  it("successful repeated runs produce separate immutable directories", async () => {
    const runIdA = buildRunId(new Date("2026-01-01T00:00:00.000Z"), "run-1");
    const runIdB = buildRunId(new Date("2026-01-02T00:00:00.000Z"), "run-2");

    const { publishedPath: pathA } = await publishRun(fs, { projectDir, runId: runIdA, files: [makeFile("campaigns.json", "run-1-content")], manifest: makeManifest(runIdA) });
    const { publishedPath: pathB } = await publishRun(fs, { projectDir, runId: runIdB, files: [makeFile("campaigns.json", "run-2-content")], manifest: makeManifest(runIdB) });

    expect(pathA).not.toBe(pathB);
    expect(await nodeReadFile(path.join(pathA, "campaigns.json"), "utf8")).toBe("run-1-content");
    expect(await nodeReadFile(path.join(pathB, "campaigns.json"), "utf8")).toBe("run-2-content");
  });

  it("refuses to reuse an existing completed run id, and does not alter the existing directory", async () => {
    const runId = buildRunId(new Date("2026-01-01T00:00:00.000Z"), "run-reuse");
    await publishRun(fs, { projectDir, runId, files: [makeFile("campaigns.json", "original")], manifest: makeManifest(runId) });

    await expect(publishRun(fs, { projectDir, runId, files: [makeFile("campaigns.json", "attempted-overwrite")], manifest: makeManifest(runId) })).rejects.toThrow(/refusing to reuse/i);

    expect(await nodeReadFile(path.join(projectDir, runId, "campaigns.json"), "utf8")).toBe("original");
  });

  it("a failed run cannot reuse a run id that already has a completed manifest", async () => {
    const runId = buildRunId(new Date("2026-01-01T00:00:00.000Z"), "run-completed-then-failed-attempt");
    await publishRun(fs, { projectDir, runId, files: [makeFile("campaigns.json", "original")], manifest: makeManifest(runId) });

    const failedManifest = makeManifest(runId, { failures: [{ dataset: "campaigns", error: "synthetic" }], completedDatasets: [] });
    await expect(publishRun(fs, { projectDir, runId, files: [], manifest: failedManifest })).rejects.toThrow(/refusing to reuse/i);
  });

  it("a completed manifest's completedDatasets exactly equals requiredDatasets on disk", async () => {
    const runId = buildRunId(new Date("2026-01-01T00:00:00.000Z"), "run-exact-datasets");
    const manifest = makeManifest(runId, {
      requiredDatasets: ["campaigns", "weekly_briefs", "auth-identities"],
      completedDatasets: ["auth-identities", "campaigns", "weekly_briefs"],
    });
    const files = [makeFile("campaigns.json", "a"), makeFile("weekly_briefs.json", "b"), makeFile("auth-identities.json", "c")];

    const { publishedPath } = await publishRun(fs, { projectDir, runId, files, manifest });
    const written = JSON.parse(await nodeReadFile(path.join(publishedPath, "manifest.json"), "utf8"));
    expect(written.status).toBe("completed");
    expect([...written.completedDatasets].sort()).toEqual([...written.requiredDatasets].sort());
  });

  it("a failed manifest (data-collection failure) publishes only a failed-run directory with no data files, even if some datasets individually succeeded", async () => {
    const runId = buildRunId(new Date("2026-01-01T00:00:00.000Z"), "run-mixed-failure");
    const manifest = makeManifest(runId, {
      requiredDatasets: ["campaigns", "kpi_daily"],
      completedDatasets: ["campaigns"],
      failures: [{ dataset: "kpi_daily", error: "synthetic mismatch" }],
    });

    const { publishedPath } = await publishRun(fs, { projectDir, runId, files: [makeFile("campaigns.json", "content")], manifest });

    expect(publishedPath).toBe(path.join(projectDir, `${runId}-failed`));
    const entries = await readdir(publishedPath);
    expect(entries).toEqual(["manifest.json"]);
  });
});
