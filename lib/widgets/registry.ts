import { AiPrioritiesWidget } from "@/components/dashboard/widgets/ai-priorities-widget";
import { ApprovalQueueWidget } from "@/components/dashboard/widgets/approval-queue-widget";
import { GreetingWidget, type GreetingWidgetData } from "@/components/dashboard/widgets/greeting-widget";
import { KpiCardWidget, type KpiCardData } from "@/components/dashboard/widgets/kpi-card-widget";
import { LiveAlertsWidget } from "@/components/dashboard/widgets/live-alerts-widget";
import { QuickActionsWidget } from "@/components/dashboard/widgets/quick-actions-widget";
import {
  RevenueForecastWidget,
  type RevenueForecastViewModel,
} from "@/components/dashboard/widgets/revenue-forecast-widget";
import { SyncPanelWidget } from "@/components/dashboard/widgets/sync-panel-widget";
import type { DashboardData } from "@/lib/dashboard/types";
import { formatCurrency, formatNumber, formatPercentage, formatTrend } from "@/lib/format/kpi";
import type { TenantConfig, WidgetKey } from "@/lib/tenancy/types";
import type { AnyWidgetDefinition } from "@/lib/widgets/types";
import { defineWidget } from "@/lib/widgets/types";

/**
 * KpiCardWidget renders its own (sometimes tenant-specific, e.g. product KPI)
 * label internally, so the WidgetFrame card header is left blank to avoid
 * showing the label twice.
 */
function kpiWidget(
  key: WidgetKey,
  selectData: (data: DashboardData, tenant: TenantConfig) => KpiCardData,
): AnyWidgetDefinition {
  return defineWidget<KpiCardData>({
    key,
    title: "",
    defaultSize: "sm",
    component: KpiCardWidget,
    selectData,
  });
}

const WIDGET_DEFINITIONS: Record<WidgetKey, AnyWidgetDefinition> = {
  greeting: defineWidget<GreetingWidgetData>({
    key: "greeting",
    title: "",
    defaultSize: "full",
    component: GreetingWidget,
    selectData: (data, tenant) => ({ ...data.greeting, serviceStatus: tenant.serviceStatus }),
  }),

  revenueToday: kpiWidget("revenueToday", (data, tenant) => ({
    label: "Revenue Today",
    value: formatCurrency(data.revenueToday.amount, tenant.currency, tenant.locale),
    trend: formatTrend(data.revenueToday.trend),
    helpText: `Target ${formatCurrency(data.revenueToday.targetAmount, tenant.currency, tenant.locale)}`,
  })),

  ordersToday: kpiWidget("ordersToday", (data, tenant) => ({
    label: "Orders Today",
    value: formatNumber(data.ordersToday.count, tenant.locale),
    trend: formatTrend(data.ordersToday.trend),
  })),

  reservationsTonight: kpiWidget("reservationsTonight", (data) => ({
    label: "Reservations Tonight",
    value: `${data.reservationsTonight.count} / ${data.reservationsTonight.capacity}`,
    trend: formatTrend(data.reservationsTonight.trend),
    helpText: "Covers booked vs capacity",
  })),

  whatsappLeads: kpiWidget("whatsappLeads", (data) => ({
    label: "WhatsApp Leads",
    value: String(data.whatsappLeads.unanswered),
    trend: formatTrend(data.whatsappLeads.trend, "increase-is-bad"),
    helpText: `${data.whatsappLeads.totalToday} conversations today`,
  })),

  reviewScore: kpiWidget("reviewScore", (data) => ({
    label: "Review Score",
    value: `${data.reviewScore.average.toFixed(1)} ★`,
    trend: formatTrend(data.reviewScore.trend),
    helpText: `${data.reviewScore.totalReviews} reviews`,
  })),

  productKpi: kpiWidget("productKpi", (data, tenant) => ({
    label: tenant.productKpi.label,
    value: tenant.productKpi.unit
      ? `${formatNumber(data.productKpi.value, tenant.locale)} ${tenant.productKpi.unit}`
      : formatNumber(data.productKpi.value, tenant.locale),
    trend: formatTrend(data.productKpi.trend),
  })),

  foodCostPercentage: kpiWidget("foodCostPercentage", (data) => ({
    label: "Food Cost %",
    value: formatPercentage(data.foodCostPercentage.value),
    trend: formatTrend(data.foodCostPercentage.trend, "increase-is-bad"),
    helpText: `Target ${formatPercentage(data.foodCostPercentage.targetValue)}`,
  })),

  laborPercentage: kpiWidget("laborPercentage", (data) => ({
    label: "Labor %",
    value: formatPercentage(data.laborPercentage.value),
    trend: formatTrend(data.laborPercentage.trend, "increase-is-bad"),
    helpText: `Target ${formatPercentage(data.laborPercentage.targetValue)}`,
  })),

  syncPanel: defineWidget({
    key: "syncPanel",
    title: "Data Sync",
    defaultSize: "md",
    component: SyncPanelWidget,
    selectData: (data) => data.syncSources,
  }),

  aiPriorities: defineWidget({
    key: "aiPriorities",
    title: "AI Priorities",
    defaultSize: "md",
    component: AiPrioritiesWidget,
    selectData: (data) => data.aiPriorities,
  }),

  approvalQueue: defineWidget({
    key: "approvalQueue",
    title: "Approval Queue",
    defaultSize: "md",
    component: ApprovalQueueWidget,
    selectData: (data) => data.approvalQueue,
  }),

  liveAlerts: defineWidget({
    key: "liveAlerts",
    title: "Live Alerts",
    defaultSize: "md",
    component: LiveAlertsWidget,
    selectData: (data) => data.liveAlerts,
  }),

  revenueForecast: defineWidget<RevenueForecastViewModel>({
    key: "revenueForecast",
    title: "Revenue Forecast",
    defaultSize: "lg",
    component: RevenueForecastWidget,
    selectData: (data, tenant) => ({
      ...data.revenueForecast,
      currency: tenant.currency,
      locale: tenant.locale,
    }),
  }),

  quickActions: defineWidget({
    key: "quickActions",
    title: "Quick Actions",
    defaultSize: "full",
    component: QuickActionsWidget,
    selectData: (data) => data.quickActions,
  }),
};

export function getWidgetDefinition(key: WidgetKey): AnyWidgetDefinition {
  return WIDGET_DEFINITIONS[key];
}
