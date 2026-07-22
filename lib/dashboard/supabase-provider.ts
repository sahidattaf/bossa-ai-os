import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

import type { DashboardDataProvider } from "./data-provider";
import type { DashboardData } from "./types";

const NO_DATA_TREND = { deltaPercent: 0, comparisonLabel: "no data yet" };

/**
 * Real implementation of DashboardDataProvider. Phase 2's schema has no
 * operational tables yet (orders/reservations/inventory/etc. are Phase 3),
 * so every operational field is an honest zero/empty value rather than a
 * fabricated number — this is the "safe empty state when operational tables
 * aren't populated yet" behavior the issue asks for. All queries run through
 * the caller's own session-bound client, so they're bounded by RLS.
 */
export class SupabaseDashboardDataProvider implements DashboardDataProvider {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async getDashboardData(organizationId: string): Promise<DashboardData> {
    const { data: organization } = await this.supabase
      .from("organizations")
      .select("name")
      .eq("id", organizationId)
      .maybeSingle();

    const organizationName = organization?.name ?? "your organization";

    return {
      greeting: {
        headline: `Good to see you, ${organizationName} team`,
        summary:
          "Live operational data isn't connected yet. Orders, reservations, and the rest of the dashboard populate once Phase 3 ships.",
      },
      revenueToday: { amount: 0, targetAmount: 0, trend: NO_DATA_TREND },
      ordersToday: { count: 0, trend: NO_DATA_TREND },
      reservationsTonight: { count: 0, capacity: 0, trend: NO_DATA_TREND },
      whatsappLeads: { unanswered: 0, totalToday: 0, trend: NO_DATA_TREND },
      reviewScore: { average: 0, totalReviews: 0, trend: NO_DATA_TREND },
      productKpi: { value: 0, trend: NO_DATA_TREND },
      foodCostPercentage: { value: 0, targetValue: 0, trend: NO_DATA_TREND },
      laborPercentage: { value: 0, targetValue: 0, trend: NO_DATA_TREND },
      syncSources: [],
      aiPriorities: [],
      approvalQueue: [],
      liveAlerts: [],
      revenueForecast: { labels: [], projectedAmounts: [] },
      quickActions: [],
    };
  }
}
