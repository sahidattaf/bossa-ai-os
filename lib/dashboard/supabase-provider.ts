import type { SupabaseClient } from "@supabase/supabase-js";

import { toOperationalError } from "@/lib/errors";
import { listRecentKpiSnapshots } from "@/lib/operations/kpi-snapshots";
import type { Database } from "@/lib/supabase/database.types";

import type { DashboardDataProvider } from "./data-provider";
import type { AiPriorityItem, ApprovalQueueItem, DashboardData, LiveAlertItem, Priority } from "./types";

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

const SEVERITY_TO_PRIORITY: Record<string, Priority> = {
  critical: "High",
  warning: "Medium",
  info: "Low",
};

/**
 * Real implementation of DashboardDataProvider (Phase 3A's live aggregates,
 * Phase 4A's real AI Executive records). Every "today"/"tonight" number
 * comes from one call to get_dashboard_snapshot() (20260722000007) — a
 * single SECURITY INVOKER, organization-scoped, dashboard.read-gated query,
 * never N+1. aiPriorities/liveAlerts/approvalQueue now read real
 * ai_recommendations/ai_signals/ai_approvals rows (issue #18 scope 8:
 * "Integrate the dashboard AI priorities widget with real recommendation
 * records while keeping the existing provider contract stable") — the
 * DashboardData shape itself is unchanged from Phase 1.
 *
 * Food cost and labor percentage widgets stay at their Phase 2 honest-empty
 * values: no source tables for either exist yet in this phase.
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

    const [recentSnapshots, aiPriorities, liveAlerts, approvalQueue] = await Promise.all([
      snapshot.finance_visible
        ? listRecentKpiSnapshots(this.supabase, organizationId, { days: 7 })
        : Promise.resolve([]),
      this.buildAiPriorities(organizationId),
      this.buildLiveAlerts(organizationId),
      this.buildApprovalQueue(organizationId),
    ]);
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
      aiPriorities,
      approvalQueue,
      liveAlerts,
      revenueForecast: {
        labels: orderedSnapshots.map((row) => row.snapshot_date),
        projectedAmounts: orderedSnapshots.map((row) => row.revenue),
      },
      quickActions: [],
    };
  }

  /** Top open recommendations by priority_score — real evidence-backed AI Executive output, not a synthetic derivation. */
  private async buildAiPriorities(organizationId: string): Promise<AiPriorityItem[]> {
    const { data, error } = await this.supabase
      .from("ai_recommendations")
      .select("id, title, executive_summary, severity, status, recommendation_type")
      .eq("organization_id", organizationId)
      .in("status", ["proposed", "approved", "executing"])
      .order("priority_score", { ascending: false })
      .limit(5);

    if (error) throw toOperationalError(error);

    return (data ?? []).map((row) => ({
      id: row.id,
      title: row.title,
      priority: SEVERITY_TO_PRIORITY[row.severity] ?? "Low",
      owner: "AI Executive",
      detail: row.executive_summary,
    }));
  }

  /** Active signals — the same rows the AI Executive workspace's signal feed shows. */
  private async buildLiveAlerts(organizationId: string): Promise<LiveAlertItem[]> {
    const { data, error } = await this.supabase
      .from("ai_signals")
      .select("id, severity, title, observed_at")
      .eq("organization_id", organizationId)
      .eq("status", "active")
      .in("severity", ["warning", "critical"])
      .order("observed_at", { ascending: false })
      .limit(5);

    if (error) throw toOperationalError(error);

    return (data ?? []).map((row) => ({
      id: row.id,
      severity: row.severity as LiveAlertItem["severity"],
      message: row.title,
      occurredAt: row.observed_at,
    }));
  }

  /** Pending approvals awaiting a decision — same query the approvals route uses. */
  private async buildApprovalQueue(organizationId: string): Promise<ApprovalQueueItem[]> {
    const { data: approvals, error: approvalsError } = await this.supabase
      .from("ai_approvals")
      .select("id, recommendation_id")
      .eq("organization_id", organizationId)
      .eq("status", "pending")
      .limit(5);

    if (approvalsError) throw toOperationalError(approvalsError);
    if (!approvals || approvals.length === 0) return [];

    const { data: recommendations, error: recommendationsError } = await this.supabase
      .from("ai_recommendations")
      .select("id, title, recommendation_type")
      .eq("organization_id", organizationId)
      .in(
        "id",
        approvals.map((a) => a.recommendation_id),
      );

    if (recommendationsError) throw toOperationalError(recommendationsError);

    const recommendationById = new Map((recommendations ?? []).map((r) => [r.id, r]));

    return approvals
      .map((approval) => {
        const recommendation = recommendationById.get(approval.recommendation_id);
        if (!recommendation) return null;
        return {
          id: approval.id,
          title: recommendation.title,
          type: recommendation.recommendation_type,
          requestedBy: "AI Executive",
        };
      })
      .filter((item): item is ApprovalQueueItem => item !== null);
  }
}
