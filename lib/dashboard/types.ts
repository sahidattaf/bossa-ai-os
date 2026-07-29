import type { TrendInfo } from "@/lib/format/kpi";

export type AlertSeverity = "info" | "warning" | "critical";
export type Priority = "High" | "Medium" | "Low";
export type SyncStatus = "synced" | "syncing" | "error";

export interface GreetingData {
  headline: string;
  summary: string;
}

export interface RevenueTodayData {
  amount: number;
  targetAmount: number;
  trend: TrendInfo;
}

export interface OrdersTodayData {
  count: number;
  trend: TrendInfo;
}

export interface ActiveOrdersData {
  count: number;
  trend: TrendInfo;
}

export interface ReservationsTonightData {
  count: number;
  capacity: number;
  trend: TrendInfo;
}

export interface WhatsAppLeadsData {
  unanswered: number;
  totalToday: number;
  trend: TrendInfo;
}

export interface ReviewScoreData {
  average: number;
  totalReviews: number;
  trend: TrendInfo;
}

export interface ProductKpiData {
  value: number;
  trend: TrendInfo;
}

export interface CostRatioData {
  value: number;
  targetValue: number;
  trend: TrendInfo;
}

export interface SyncSource {
  name: string;
  status: SyncStatus;
  lastSyncedAt: string;
}

export interface AiPriorityItem {
  id: string;
  title: string;
  priority: Priority;
  owner: string;
  detail: string;
}

export interface ApprovalQueueItem {
  id: string;
  title: string;
  type: string;
  requestedBy: string;
}

export type OwnerCockpitRecommendationStatus = "proposed" | "approved" | "executing";

export interface OwnerCockpitRecommendation {
  id: string;
  title: string;
  severity: string;
  priority: Priority;
  executiveSummary: string;
  status: OwnerCockpitRecommendationStatus;
  href: string;
  ctaLabel: string;
  hasPendingApproval: boolean;
}

export interface LiveAlertItem {
  id: string;
  severity: AlertSeverity;
  message: string;
  occurredAt: string;
}

export interface RevenueForecastData {
  labels: string[];
  projectedAmounts: number[];
}

export interface QuickActionItem {
  id: string;
  label: string;
  description: string;
}

export interface DashboardData {
  greeting: GreetingData;
  revenueToday: RevenueTodayData;
  ordersToday: OrdersTodayData;
  activeOrders: ActiveOrdersData;
  reservationsTonight: ReservationsTonightData;
  whatsappLeads: WhatsAppLeadsData;
  reviewScore: ReviewScoreData;
  productKpi: ProductKpiData;
  foodCostPercentage: CostRatioData;
  laborPercentage: CostRatioData;
  syncSources: SyncSource[];
  aiPriorities: AiPriorityItem[];
  approvalQueue: ApprovalQueueItem[];
  ownerCockpitRecommendation: OwnerCockpitRecommendation | null;
  liveAlerts: LiveAlertItem[];
  revenueForecast: RevenueForecastData;
  quickActions: QuickActionItem[];
}
