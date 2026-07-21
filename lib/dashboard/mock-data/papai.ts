import type { DashboardData } from "@/lib/dashboard/types";

/** Independent onboarding demo data for Papai Since 1933 — no BOSSA figures or copy. */
export const PAPAI_DASHBOARD_DATA: DashboardData = {
  greeting: {
    headline: "Good evening, Papai team",
    summary:
      "Finish onboarding the heritage recipe list and confirm supplier accounts before soft-opening week.",
  },
  revenueToday: {
    amount: 8200,
    targetAmount: 15000,
    trend: { deltaPercent: 22.5, comparisonLabel: "vs last Friday" },
  },
  ordersToday: {
    count: 54,
    trend: { deltaPercent: 9.7, comparisonLabel: "vs last Friday" },
  },
  reservationsTonight: {
    count: 28,
    capacity: 60,
    trend: { deltaPercent: 5.3, comparisonLabel: "vs last Friday" },
  },
  whatsappLeads: {
    unanswered: 1,
    totalToday: 9,
    trend: { deltaPercent: -10.0, comparisonLabel: "vs yesterday" },
  },
  reviewScore: {
    average: 4.9,
    totalReviews: 37,
    trend: { deltaPercent: 2.4, comparisonLabel: "vs last month" },
  },
  productKpi: {
    value: 21,
    trend: { deltaPercent: 12.8, comparisonLabel: "vs last Friday" },
  },
  foodCostPercentage: {
    value: 26.9,
    targetValue: 28,
    trend: { deltaPercent: -3.2, comparisonLabel: "vs last week" },
  },
  laborPercentage: {
    value: 24.1,
    targetValue: 25,
    trend: { deltaPercent: -0.6, comparisonLabel: "vs last week" },
  },
  syncSources: [
    { name: "Notion Command Center", status: "synced", lastSyncedAt: "12 minutes ago" },
    { name: "Google Sheets", status: "synced", lastSyncedAt: "12 minutes ago" },
    { name: "Supabase", status: "error", lastSyncedAt: "attempted 20 minutes ago" },
  ],
  aiPriorities: [
    {
      id: "priority-onboarding",
      title: "Finish heritage recipe costing before soft opening",
      priority: "High",
      owner: "PapaiLegacyGPT",
      detail: "12 of 34 recipes still missing ingredient costs",
    },
    {
      id: "priority-suppliers",
      title: "Confirm two backup produce suppliers",
      priority: "Medium",
      owner: "PapaiLegacyGPT",
      detail: "Only one active supplier account on file",
    },
    {
      id: "priority-staff",
      title: "Schedule front-of-house training session",
      priority: "Medium",
      owner: "PapaiLegacyGPT",
      detail: "New hires start next week",
    },
  ],
  approvalQueue: [
    {
      id: "approval-menu",
      title: "Approve opening-week menu pricing",
      type: "finance",
      requestedBy: "PapaiLegacyGPT",
    },
  ],
  liveAlerts: [
    {
      id: "alert-supplier-gap",
      severity: "warning",
      message: "Single point of failure on produce supply",
      occurredAt: "40 minutes ago",
    },
    {
      id: "alert-sync-error",
      severity: "critical",
      message: "Supabase sync failed on last attempt",
      occurredAt: "20 minutes ago",
    },
  ],
  revenueForecast: {
    labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    projectedAmounts: [6200, 6800, 7100, 7600, 9800, 12400, 9100],
  },
  quickActions: [
    {
      id: "action-recipes",
      label: "Finish recipe costing",
      description: "22 recipes remaining before opening-week pricing locks.",
    },
    {
      id: "action-suppliers",
      label: "Review supplier accounts",
      description: "Add a backup produce supplier.",
    },
    {
      id: "action-training",
      label: "Schedule staff training",
      description: "Front-of-house onboarding session for new hires.",
    },
  ],
};
