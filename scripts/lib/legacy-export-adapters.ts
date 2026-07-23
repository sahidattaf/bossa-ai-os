/**
 * Real Supabase-client and real-filesystem implementations of the small
 * interfaces scripts/lib/legacy-export-io.ts defines (LegacyTableReader,
 * AuthIdentityReader, FileSystemPort). Kept in their own module, separate
 * from scripts/export-legacy-supabase-data.ts, purely so they're importable
 * in tests against a mocked Supabase-like object without triggering that
 * script's top-level `main()` side effect.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";

import type { AuthIdentityReader, FileSystemPort, LegacyTableReader } from "./legacy-export-io";

/** `.from(table).select("id", {count:"exact", head:true})` for the exact count, `.select("*").order("id", {ascending:true}).range(offset, offset+limit-1)` for each page — the two calls fetchTableStable's pagination loop actually needs. */
export function createSupabaseTableReader(supabase: SupabaseClient): LegacyTableReader {
  return {
    async getExactCount(table) {
      const { count, error } = await supabase.from(table).select("id", { count: "exact", head: true });
      if (error) throw new Error(`Failed to read the exact row count for "${table}": ${error.message}`);
      return count ?? 0;
    },
    async getPage(table, offset, limit) {
      const { data, error } = await supabase
        .from(table)
        .select("*")
        .order("id", { ascending: true })
        .range(offset, offset + limit - 1);
      if (error) throw new Error(`Failed to read "${table}" at offset ${offset}: ${error.message}`);
      return data ?? [];
    },
  };
}

/** GoTrue's admin `listUsers({ page, perPage })` — the one call fetchAuthIdentitiesStable's pagination loop needs. */
export function createSupabaseAuthIdentityReader(supabase: SupabaseClient): AuthIdentityReader {
  return {
    async listUsersPage(page, perPage) {
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
      if (error) throw new Error(`Failed to list legacy auth users (page ${page}): ${error.message}`);
      return { users: data.users };
    },
  };
}

/** Thin wrapper over node:fs/promises satisfying FileSystemPort. `pathExists` uses `access()` (existence only, no read), so it works correctly for both files and directories. */
export function createNodeFileSystemPort(): FileSystemPort {
  return {
    mkdir: async (targetPath) => {
      await mkdir(targetPath, { recursive: true });
    },
    writeFile: async (targetPath, content) => {
      await writeFile(targetPath, content, "utf8");
    },
    readFile: async (targetPath) => readFile(targetPath, "utf8"),
    rename: async (oldPath, newPath) => {
      await rename(oldPath, newPath);
    },
    rm: async (targetPath) => {
      await rm(targetPath, { recursive: true, force: true });
    },
    pathExists: async (targetPath) => {
      try {
        await access(targetPath);
        return true;
      } catch {
        return false;
      }
    },
  };
}
