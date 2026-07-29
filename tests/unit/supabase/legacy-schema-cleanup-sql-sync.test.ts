import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * supabase/production-ops/legacy_schema_cleanup.sql is the canonical,
 * documented production script; supabase/tests/legacy_schema_cleanup.test.sql
 * inlines a copy of its two function definitions rather than \ir-including
 * the canonical file directly, because `supabase test db` runs pgTAP inside
 * a container that only mounts supabase/tests/ -- a sibling directory like
 * supabase/production-ops/ is not visible to it (confirmed directly by a
 * real CI failure, "No such file or directory", when \ir was first tried
 * across that boundary).
 *
 * This test is what makes that duplication safe: it runs on the host, needs
 * no Docker/Postgres, and fails loudly the moment the two copies diverge --
 * so the code a human reviews as "the real script" and the code CI actually
 * proves correct can never silently drift apart.
 */

const REPO_ROOT = path.resolve(__dirname, "../../..");
const CANONICAL_PATH = path.join(REPO_ROOT, "supabase/production-ops/legacy_schema_cleanup.sql");
const TEST_PATH = path.join(REPO_ROOT, "supabase/tests/legacy_schema_cleanup.test.sql");

function extractSyncBlock(content: string, blockName: string, sourceLabel: string): string {
  const beginMarker = `-- SYNC-BEGIN: ${blockName}`;
  const endMarker = `-- SYNC-END: ${blockName}`;
  const beginIndex = content.indexOf(beginMarker);
  const endIndex = content.indexOf(endMarker);

  if (beginIndex === -1) {
    throw new Error(`Could not find "${beginMarker}" in ${sourceLabel} -- the sync markers must not be removed or renamed.`);
  }
  if (endIndex === -1) {
    throw new Error(`Could not find "${endMarker}" in ${sourceLabel} -- the sync markers must not be removed or renamed.`);
  }
  if (endIndex < beginIndex) {
    throw new Error(`"${endMarker}" appears before "${beginMarker}" in ${sourceLabel} -- markers are out of order.`);
  }

  return content.slice(beginIndex, endIndex + endMarker.length);
}

describe("legacy_schema_cleanup.sql stays in sync between production-ops and the pgTAP test", () => {
  const canonical = readFileSync(CANONICAL_PATH, "utf8");
  const test = readFileSync(TEST_PATH, "utf8");

  it("perform_legacy_bossa_schema_cleanup is byte-identical in both files", () => {
    const canonicalBlock = extractSyncBlock(canonical, "perform_legacy_bossa_schema_cleanup", "supabase/production-ops/legacy_schema_cleanup.sql");
    const testBlock = extractSyncBlock(test, "perform_legacy_bossa_schema_cleanup", "supabase/tests/legacy_schema_cleanup.test.sql");
    expect(testBlock).toBe(canonicalBlock);
  });

  it("verify_legacy_bossa_schema_cleanup is byte-identical in both files", () => {
    const canonicalBlock = extractSyncBlock(canonical, "verify_legacy_bossa_schema_cleanup", "supabase/production-ops/legacy_schema_cleanup.sql");
    const testBlock = extractSyncBlock(test, "verify_legacy_bossa_schema_cleanup", "supabase/tests/legacy_schema_cleanup.test.sql");
    expect(testBlock).toBe(canonicalBlock);
  });

  it("the canonical file never calls either function -- defining them must stay inert", () => {
    for (const blockName of ["perform_legacy_bossa_schema_cleanup", "verify_legacy_bossa_schema_cleanup"]) {
      const block = extractSyncBlock(canonical, blockName, "supabase/production-ops/legacy_schema_cleanup.sql");
      expect(block).not.toMatch(new RegExp(`select\\s+public\\.${blockName}\\s*\\(`, "i"));
    }
  });
});
