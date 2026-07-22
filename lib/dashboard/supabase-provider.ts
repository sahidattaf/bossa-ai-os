import type { SupabaseClient } from "@supabase/supabase-js";

import { toOperationalError } from "@/lib/errors";
import { listRecentKpiSnapshots } from "@/lib/operations/kpi-snapshots";
import type { Database } from "@/lib/supabase/database.types";

import type { DashboardDataProvider } from "./data-provider";
import type { AiPriorityItem, DashboardData, LiveAlertItem } from "./types";

const NO_DATA_TREND = { deltaPercent: 0, comparisonLabel: "no data yet" };

/** Shape of the jsonb get_dashboard_snapshot() returns — see 20260722000007_dashboard_aggregate_rpc.sql. */
interface DashboardSnapshot {
  as_of: string;
  orders_today: number;
  orders_cancelled_today: number;
  reservations_tonight: number;
  reservations_capacity_tonight: number;
  reservations_no_show_today: number;
  new_leads_today: number;
  unanswered_leads: number;
  finance_visible: boolean;
  revenue_today: number | null;
  average_ticket_today: number | null;
}

function buildAiPriorities(snapshot: DashboardSnapshot): AiPriorityItem[] {
  const priorities: AiPriorityItem[] = [];

  if (snapshot.unanswered_leads > 0) {
    priorities.push({
      id: "unanswered-leads",
      title: `Respond to ${snapshot.unanswered_leads} unanswered lead${snapshot.unanswered_leads === 1 ? "" : "s"}`,
      priority: snapshot.unanswered_leads >= 3 ? "High" : "Medium",
      owner: "CRM",
      detail: "New leads are still sitting in the intake queue with no reply.",
    });
  }

  if (snapshot.reservations_tonight === 0) {
    priorities.push({
      id: "no-reservations-tonight",
      title: "No reservations booked tonight",
      priority: "Medium",
      owner: "Reservations",
      detail: "Consider a same-day promotion or outreach to regulars.",
    });
  }

  if (snapshot.orders_cancelled_today > 0) {
    priorities.push({
      id: "orders-cancelled-today",
      title: `Review ${snapshot.orders_cancelled_today} cancelled order${snapshot.orders_cancelled_today === 1 ? "" : "s"} today`,
      priority: "Low",
      owner: "Operations",
      detail: "Cancellations can point to kitchen capacity or menu availability issues.",
    });
  }

  return priorities;
}

function buildLiveAlerts(snapshot: DashboardSnapshot): LiveAlertItem[] {
  const alerts: LiveAlertItem[] = [];
  const now = snapshot.as_of;

  if (snapshot.unanswered_leads >= 3) {
    alerts.push({
      id: "unanswered-leads-threshold",
      severity: "warning",
      message: `${snapshot.unanswered_leads} leads have gone unanswered today.`,
      occurredAt: now,
    });
  }

  if (snapshot.reservations_no_show_today > 0) {
    alerts.push({
      id: "no-shows-today",
      severity: "info",
      message: `${snapshot.reservations_no_show_today} no-show${snapshot.reservations_no_show_today === 1 ? "" : "s"} recorded today.`,
      occurredAt: now,
    });
  }

  if (snapshot.orders_cancelled_today > 0) {
    alerts.push({
      id: "cancellations-today",
      severity: "warning",
      message: `${snapshot.orders_cancelled_today} order${snapshot.orders_cancelled_today === 1 ? "" : "s"} cancelled today.`,
      occurredAt: now,
    });
  }

  return alerts;
}

/**
 * Real implementation of DashboardDataProvider (Phase 3A, issue #16 scope
 * E). Every "today"/"tonight" number comes from one call to the
 * get_dashboard_snapshot() RPC (20260722000007) — a single SECURITY INVOKER,
 * organization-scoped, dashboard.read-gated query, never N+1. Revenue-shaped
 * fields (revenue_today, average_ticket_today) come back null unless the
 * caller also has finance.read, in which case they render as an honest zero
 * — never a fabricated number.
 *
 * Food cost and labor percentage widgets stay at their Phase 2 honest-empty
 * values: no source tables for either exist yet in Phase 3A (out of scope —
 * see docs/PHASE_3_IMPLEMENTATION_REPORT.md). Same for reviewScore and
 * productKpi: no reviews table and no product-KPI-to-order-item mapping
 * exist yet either.
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

    const { data: snapshotData, error: snapshotError } = await this.supabase.rpc("get_dashboard_snapshot", {
      p_organization_id: organizationId,
    });

    if (snapshotError) throw toOperationalError(snapshotError);
    const snapshot = snapshotData as unknown as DashboardSnapshot;

    // Trailing actual daily revenue, oldest first — a deterministic baseline
    // trend line, not a predictive model (issue #16 scope E: "documented
    // deterministic logic"). Only meaningful with finance.read; otherwise
    // stays an honest empty state, matching revenueToday's own gating.
    const recentSnapshots = snapshot.finance_visible
      ? await listRecentKpiSnapshots(this.supabase, organizationId, { days: 7 })
      : [];
    const orderedSnapshots = [...recentSnapshots].reverse();

    return {
      greeting: {
        headline: `Good to see you, ${organizationName} team`,
        summary: `Live operational data as of ${new Date(snapshot.as_of).toLocaleString()}.`,
      },
      revenueToday: {
        amount: snapshot.revenue_today ?? 0,
        targetAmount: 0,
        trend: NO_DATA_TREND,
      },
      ordersToday: { count: snapshot.orders_today, trend: NO_DATA_TREND },
      reservationsTonight: {
        count: snapshot.reservations_tonight,
        capacity: snapshot.reservations_capacity_tonight,
        trend: NO_DATA_TREND,
      },
      whatsappLeads: {
        unanswered: snapshot.unanswered_leads,
        totalToday: snapshot.new_leads_today,
        trend: NO_DATA_TREND,
      },
      // No reviews table exists yet (Phase 3B seam only) — honest empty state.
      reviewScore: { average: 0, totalReviews: 0, trend: NO_DATA_TREND },
      // No product-KPI-to-order-item mapping exists yet — honest empty state.
      productKpi: { value: 0, trend: NO_DATA_TREND },
      // No food-cost/labor source tables exist yet — honest empty state.
      foodCostPercentage: { value: 0, targetValue: 0, trend: NO_DATA_TREND },
      laborPercentage: { value: 0, targetValue: 0, trend: NO_DATA_TREND },
      syncSources: [],
      aiPriorities: buildAiPriorities(snapshot),
      approvalQueue: [],
      liveAlerts: buildLiveAlerts(snapshot),
      revenueForecast: {
        labels: orderedSnapshots.map((row) => row.snapshot_date),
        projectedAmounts: orderedSnapshots.map((row) => row.revenue),
      },
      quickActions: [],
    };
  }
}
