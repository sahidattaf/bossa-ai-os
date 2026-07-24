import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { createSupabaseTableReader } from "@/scripts/lib/legacy-export-adapters";

interface RecordedPageCall {
  table: string;
  orderColumn: string;
  orderAscending: boolean;
  range: [number, number];
}

interface RecordedCountCall {
  table: string;
}

/**
 * A minimal fake mimicking exactly the Supabase query-chain shape
 * createSupabaseTableReader actually calls
 * (`.from(table).select(cols, opts).order(col, opts).range(from, to)` for a
 * page, `.from(table).select(cols, {count:"exact", head:true})` for the
 * count) — no real network, no real Supabase client, just enough surface to
 * record what was requested and hand back canned pages.
 */
function createFakeSupabase(pagesByTable: Record<string, unknown[][]>, countsByTable: Record<string, number>) {
  const pageCalls: RecordedPageCall[] = [];
  const countCalls: RecordedCountCall[] = [];

  const client = {
    from(table: string) {
      return {
        select(_columns: string, options?: { count?: string; head?: boolean }) {
          if (options?.head) {
            countCalls.push({ table });
            return Promise.resolve({ count: countsByTable[table] ?? 0, error: null });
          }
          return {
            order(column: string, orderOptions: { ascending: boolean }) {
              return {
                range(from: number, to: number) {
                  const pageSize = to - from + 1;
                  const pageIndex = Math.floor(from / pageSize);
                  pageCalls.push({ table, orderColumn: column, orderAscending: orderOptions.ascending, range: [from, to] });
                  const page = pagesByTable[table]?.[pageIndex] ?? [];
                  return Promise.resolve({ data: page, error: null });
                },
              };
            },
          };
        },
      };
    },
  };

  return { client: client as unknown as SupabaseClient, pageCalls, countCalls };
}

describe("legacy-export-adapters: createSupabaseTableReader (mocked Supabase query chain)", () => {
  it("requests the exact count via a head request before paginating", async () => {
    const { client, countCalls } = createFakeSupabase({ campaigns: [[]] }, { campaigns: 0 });
    const reader = createSupabaseTableReader(client);

    await reader.getExactCount("campaigns");

    expect(countCalls).toEqual([{ table: "campaigns" }]);
  });

  it("orders every page request by id ascending", async () => {
    const { client, pageCalls } = createFakeSupabase({ campaigns: [[{ id: 1 }]] }, { campaigns: 1 });
    const reader = createSupabaseTableReader(client);

    await reader.getPage("campaigns", 0, 500);

    expect(pageCalls).toHaveLength(1);
    expect(pageCalls[0]!.orderColumn).toBe("id");
    expect(pageCalls[0]!.orderAscending).toBe(true);
  });

  it("requests the exact [offset, offset + limit - 1] range for a given page", async () => {
    const { client, pageCalls } = createFakeSupabase({ campaigns: [[{ id: 1 }]] }, { campaigns: 1 });
    const reader = createSupabaseTableReader(client);

    await reader.getPage("campaigns", 500, 500);

    expect(pageCalls[0]!.range).toEqual([500, 999]);
  });

  it("requests increasing, non-overlapping ranges across multiple sequential page calls", async () => {
    const { client, pageCalls } = createFakeSupabase(
      { campaigns: [Array.from({ length: 3 }, (_, i) => ({ id: i + 1 })), Array.from({ length: 3 }, (_, i) => ({ id: i + 4 }))] },
      { campaigns: 6 },
    );
    const reader = createSupabaseTableReader(client);

    await reader.getPage("campaigns", 0, 3);
    await reader.getPage("campaigns", 3, 3);

    expect(pageCalls.map((call) => call.range)).toEqual([
      [0, 2],
      [3, 5],
    ]);
  });

  it("passes through the rows a page actually returns", async () => {
    const rows = [{ id: 1 }, { id: 2 }];
    const { client } = createFakeSupabase({ campaigns: [rows] }, { campaigns: 2 });
    const reader = createSupabaseTableReader(client);

    const page = await reader.getPage("campaigns", 0, 500);

    expect(page).toEqual(rows);
  });
});
