import type { DashboardData } from "@/lib/dashboard/types";

/**
 * Demo numbers carried over from the legacy static prototype's
 * legacy/static-dashboard/data.json and ai/*.js rules engine, reshaped into
 * the typed DashboardData contract.
 */
export const BOSSA_DASHBOARD_DATA: DashboardData = {
  greeting: {
    headline: "Good evening, BOSSA team",
    summary:
      "Protect premium perception, test one value bundle, and avoid reactive discounting this week.",
  },
  revenueToday: {
    amount: 45000,
    targetAmount: 120000,
    trend: { deltaPercent: -12.4, comparisonLabel: "vs last Friday" },
  },
  ordersToday: {
    count: 186,
    trend: { deltaPercent: 4.1, comparisonLabel: "vs last Friday" },
  },
  reservationsTonight: {
    count: 65,
    capacity: 180,
    trend: { deltaPercent: -8.2, comparisonLabel: "vs last Friday" },
  },
  whatsappLeads: {
    unanswered: 4,
    totalToday: 21,
    trend: { deltaPercent: 15.0, comparisonLabel: "vs yesterday" },
  },
  reviewScore: {
    average: 4.6,
    totalReviews: 812,
    trend: { deltaPercent: 0.9, comparisonLabel: "vs last month" },
  },
  productKpi: {
    value: 38,
    trend: { deltaPercent: 6.3, comparisonLabel: "vs last Friday" },
  },
  foodCostPercentage: {
    value: 31.4,
    targetValue: 30,
    trend: { deltaPercent: 2.1, comparisonLabel: "vs last week" },
  },
  laborPercentage: {
    value: 27.8,
    targetValue: 28,
    trend: { deltaPercent: -1.4, comparisonLabel: "vs last week" },
  },
  syncSources: [
    { name: "Notion Command Center", status: "synced", lastSyncedAt: "6 minutes ago" },
    { name: "Google Sheets", status: "synced", lastSyncedAt: "6 minutes ago" },
    { name: "Supabase", status: "syncing", lastSyncedAt: "in progress" },
  ],
  aiPriorities: [
    {
      id: "priority-revenue",
      title: "Test one value bundle without discounting the core brand",
      priority: "High",
      owner: "FinanceGPT",
      detail: "Revenue below target: 45000 vs target 120000",
    },
    {
      id: "priority-covers",
      title: "Launch weekday traffic campaign with clear reservation CTA",
      priority: "High",
      owner: "ServiceFlowGPT",
      detail: "Covers below target: 65 covers vs target 180",
    },
    {
      id: "priority-promo",
      title: "Protect premium perception and compare competitor offers before reacting",
      priority: "Medium",
      owner: "MarketingGPT",
      detail: "Promo pressure is marked High",
    },
  ],
  approvalQueue: [
    {
      id: "approval-bundle",
      title: "Approve weekend value bundle campaign",
      type: "marketing",
      requestedBy: "BossVisionGPT",
    },
    {
      id: "approval-pricing",
      title: "Approve chicken pricing review",
      type: "finance",
      requestedBy: "FinanceGPT",
    },
  ],
  liveAlerts: [
    {
      id: "alert-soi95",
      severity: "critical",
      message: "Soi95 running aggressive weekend promo",
      occurredAt: "18 minutes ago",
    },
    {
      id: "alert-avila",
      severity: "info",
      message: "Avila Blues holding premium pricing",
      occurredAt: "1 hour ago",
    },
    {
      id: "alert-fensi",
      severity: "warning",
      message: "Fensi menu movement on signature mains",
      occurredAt: "2 hours ago",
    },
  ],
  revenueForecast: {
    labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    projectedAmounts: [38000, 41000, 39500, 47000, 68000, 92000, 71000],
  },
  quickActions: [
    {
      id: "action-input",
      label: "Log daily input",
      description: "Update revenue, covers, and today's top issue.",
    },
    {
      id: "action-brief",
      label: "Open weekly brief",
      description: "Review this week's top threat and recommended move.",
    },
    {
      id: "action-decisions",
      label: "Review open decisions",
      description: "2 decisions are waiting on an owner.",
    },
  ],
};
