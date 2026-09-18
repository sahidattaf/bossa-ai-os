import type { DashboardData } from "@/lib/dashboard/types";

/**
 * Deterministic fictional data for GPTI-RESTAURANT-PILOT-1.
 * This dataset is not derived from BOSSA, Papai, any client, or live system.
 */
export const CARIBBEAN_EMBER_DASHBOARD_DATA: DashboardData = {
  greeting: {
    headline: "Restaurant Command Center demo",
    summary:
      "DEMO DATA — NOT LIVE. Review fictional leads, reservations, tasks, reviews, and mock AI recommendations.",
  },
  revenueToday: {
    amount: 3250,
    targetAmount: 4000,
    trend: { deltaPercent: 0, comparisonLabel: "fictional baseline" },
  },
  ordersToday: {
    count: 18,
    trend: { deltaPercent: 0, comparisonLabel: "fictional baseline" },
  },
  activeOrders: {
    count: 4,
    trend: { deltaPercent: 0, comparisonLabel: "fictional queue" },
  },
  reservationsTonight: {
    count: 11,
    capacity: 36,
    trend: { deltaPercent: 0, comparisonLabel: "fictional baseline" },
  },
  whatsappLeads: {
    unanswered: 3,
    totalToday: 12,
    trend: { deltaPercent: 0, comparisonLabel: "mock messaging only" },
  },
  reviewScore: {
    average: 4.6,
    totalReviews: 24,
    trend: { deltaPercent: 0, comparisonLabel: "fictional reviews" },
  },
  productKpi: {
    value: 7,
    trend: { deltaPercent: 0, comparisonLabel: "fictional catering inquiries" },
  },
  foodCostPercentage: {
    value: 29,
    targetValue: 30,
    trend: { deltaPercent: 0, comparisonLabel: "fictional planning value" },
  },
  laborPercentage: {
    value: 27,
    targetValue: 28,
    trend: { deltaPercent: 0, comparisonLabel: "fictional planning value" },
  },
  syncSources: [
    { name: "Demo seed", status: "synced", lastSyncedAt: "deterministic fixture" },
    { name: "Mock messaging", status: "synced", lastSyncedAt: "no live connector" },
    { name: "Mock reservations", status: "synced", lastSyncedAt: "no live connector" },
  ],
  aiPriorities: [
    {
      id: "demo-priority-leads",
      title: "Review three fictional unanswered leads",
      priority: "High",
      owner: "Demo AI Manager",
      detail: "Mock recommendation only — no message will be sent.",
    },
    {
      id: "demo-priority-reservations",
      title: "Review tonight's fictional reservation load",
      priority: "Medium",
      owner: "Demo AI Manager",
      detail: "11 demo reservations against a fictional capacity of 36.",
    },
    {
      id: "demo-priority-catering",
      title: "Follow up on fictional catering inquiries",
      priority: "Medium",
      owner: "Demo AI Manager",
      detail: "Seven synthetic catering inquiries are included in the pilot dataset.",
    },
  ],
  approvalQueue: [
    {
      id: "demo-approval-followup",
      title: "Approve a mock lead follow-up draft",
      type: "demo",
      requestedBy: "Demo AI Manager",
    },
  ],
  ownerCockpitRecommendation: {
    id: "demo-approval-followup",
    title: "Review a mock follow-up draft",
    severity: "info",
    priority: "High",
    executiveSummary:
      "A fictional lead follow-up is ready for owner review. No external message can be sent in this pilot.",
    status: "proposed",
    href: "/caribbean-ember/ai-executive/approvals",
    ctaLabel: "Review mock approval",
    hasPendingApproval: true,
  },
  liveAlerts: [
    {
      id: "demo-alert-label",
      severity: "info",
      message: "DEMO DATA — NOT LIVE",
      occurredAt: "fixture",
    },
    {
      id: "demo-alert-followup",
      severity: "warning",
      message: "3 fictional leads are awaiting mock follow-up",
      occurredAt: "fixture",
    },
  ],
  revenueForecast: {
    labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    projectedAmounts: [2800, 3000, 3100, 3300, 3600, 4200, 3500],
  },
  quickActions: [
    {
      id: "demo-action-leads",
      label: "Review demo leads",
      description: "Inspect fictional CRM records; no live outreach.",
    },
    {
      id: "demo-action-reservations",
      label: "Review demo reservations",
      description: "Inspect seeded bookings; no booking can be confirmed.",
    },
    {
      id: "demo-action-tasks",
      label: "Review demo tasks",
      description: "Use the pilot shell to inspect non-live workflow states.",
    },
  ],
};
