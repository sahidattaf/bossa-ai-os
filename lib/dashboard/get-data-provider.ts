import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

import type { DashboardDataProvider } from "./data-provider";
import { dashboardDataProvider as mockDashboardDataProvider } from "./mock-provider";
import { SupabaseDashboardDataProvider } from "./supabase-provider";

export type DashboardProviderMode = "mock" | "supabase";

/**
 * Server-only mode switch — never read on the client, never client-submitted
 * (rule 10). Controls both which DashboardDataProvider is used and whether
 * the [organizationSlug] layout requires authentication at all, so Phase 1's
 * mock demo and Phase 2's real auth+RLS path fully coexist:
 *
 * - "mock" (default, no Supabase env needed): today's Phase 1 behavior —
 *   static tenant list, MockDashboardDataProvider, no auth gate.
 * - "supabase": real auth required, tenant resolved from the database via a
 *   membership-verified query, SupabaseDashboardDataProvider used.
 */
export function getDashboardProviderMode(): DashboardProviderMode {
  return process.env.DASHBOARD_DATA_PROVIDER === "supabase" ? "supabase" : "mock";
}

/**
 * `supabase` must be provided when the mode is "supabase" (it's the
 * session-bound client from lib/supabase/server.ts — never a service-role
 * client). Omitted in `mock` mode, which needs no client at all.
 */
export function getDashboardDataProvider(supabase?: SupabaseClient<Database>): DashboardDataProvider {
  if (getDashboardProviderMode() === "supabase") {
    if (!supabase) {
      throw new Error("A Supabase client is required when DASHBOARD_DATA_PROVIDER=supabase");
    }
    return new SupabaseDashboardDataProvider(supabase);
  }

  return mockDashboardDataProvider;
}
