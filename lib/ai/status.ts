/**
 * Mirrors the CHECK constraints and status_transitions rulebook additions in
 * supabase/migrations/20260723000001_ai_tables.sql and
 * 20260723000003_ai_status_machines.sql. See lib/operations/status.ts for
 * the same convention established in Phase 3.
 */
export const AI_SEVERITIES = ["info", "warning", "critical"] as const;
export type AiSeverity = (typeof AI_SEVERITIES)[number];

export const AI_SIGNAL_STATUSES = ["active", "resolved", "suppressed"] as const;
export type AiSignalStatus = (typeof AI_SIGNAL_STATUSES)[number];

export const AI_RECOMMENDATION_STATUSES = [
  "proposed",
  "approved",
  "rejected",
  "expired",
  "executing",
  "completed",
  "failed",
  "dismissed",
] as const;
export type AiRecommendationStatus = (typeof AI_RECOMMENDATION_STATUSES)[number];

export const AI_APPROVAL_STATUSES = ["pending", "approved", "rejected", "expired"] as const;
export type AiApprovalStatus = (typeof AI_APPROVAL_STATUSES)[number];

export const AI_OUTCOME_STATUSES = [
  "pending",
  "successful",
  "partially_successful",
  "failed",
  "cancelled",
  "unknown",
] as const;
export type AiOutcomeStatus = (typeof AI_OUTCOME_STATUSES)[number];

export const AI_RISK_LEVELS = ["low", "medium", "high"] as const;
export type AiRiskLevel = (typeof AI_RISK_LEVELS)[number];

/** Polymorphic source-entity types the database validation trigger accepts. */
export const AI_SOURCE_ENTITY_TYPES = ["lead", "reservation", "order", "order_item", "daily_kpi_snapshot"] as const;
export type AiSourceEntityType = (typeof AI_SOURCE_ENTITY_TYPES)[number];

/**
 * The compiled action allow-list (issue #18 decision #8). This union is the
 * *entire* set of mutations an AI recommendation can ever cause — the action
 * router rejects anything not in this list before any write occurs.
 */
export const AI_ACTION_TYPES = [
  "assign_lead_owner",
  "change_lead_status",
  "confirm_reservation",
  "cancel_reservation",
  "change_order_status",
  "change_order_payment_status",
  "regenerate_kpi_snapshot",
  "navigate",
] as const;
export type AiActionType = (typeof AI_ACTION_TYPES)[number];
