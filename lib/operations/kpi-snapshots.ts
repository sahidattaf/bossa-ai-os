import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { toOperationalError } from "@/lib/errors";
import type { Database } from "@/lib/supabase/database.types";

type DailyKpiSnapshot = Database["public"]["Tables"]["daily_kpi_snapshots"]["Row"];
type SupabaseDb = SupabaseClient<Database>;

function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Thin wrapper over the calculate_daily_kpi_snapshot() RPC (issue #16 scope
 * F) — safe to call repeatedly for the same (organization, location, date):
 * the database function always fully recomputes and upserts. See
 * docs/KPI_SNAPSHOT_OPERATIONS.md and scripts/generate-kpi-snapshots.ts for
 * the manual invocation path; no scheduler calls this automatically in
 * Phase 3.
 */
export async function generateDailyKpiSnapshot(
  supabase: SupabaseDb,
  organizationId: string,
  options?: { date?: Date; locationId?: string | null },
): Promise<DailyKpiSnapshot> {
  const { data, error } = await supabase.rpc("calculate_daily_kpi_snapshot", {
    p_organization_id: organizationId,
    p_snapshot_date: toDateString(options?.date ?? new Date()),
    // Org-wide rollup (the SQL function's own default) is expressed by
    // omitting the arg entirely — the generated RPC arg type only allows
    // `string | undefined`, not `null`, for this optional parameter.
    p_location_id: options?.locationId ?? undefined,
  });

  if (error) throw toOperationalError(error);
  return data;
}

export async function listRecentKpiSnapshots(
  supabase: SupabaseDb,
  organizationId: string,
  options?: { days?: number },
): Promise<DailyKpiSnapshot[]> {
  const days = options?.days ?? 7;

  const { data, error } = await supabase
    .from("daily_kpi_snapshots")
    .select("*")
    .eq("organization_id", organizationId)
    .is("location_id", null)
    .order("snapshot_date", { ascending: false })
    .limit(days);

  if (error) throw toOperationalError(error);
  return data ?? [];
}
