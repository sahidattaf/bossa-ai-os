import type { DashboardData } from "./types";

/**
 * Provider-neutral contract for dashboard data. lib/dashboard/mock-provider.ts
 * is the only implementation in Phase 1; a Supabase-backed implementation can
 * be added in Phase 2 without changing any dashboard component, since
 * components only ever depend on this interface.
 */
export interface DashboardDataProvider {
  getDashboardData(organizationId: string): Promise<DashboardData>;
}
