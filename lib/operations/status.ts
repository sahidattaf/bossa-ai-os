/**
 * Mirrors the CHECK constraints and public.status_transitions rulebook in
 * supabase/migrations/20260722000001_operational_tables.sql and
 * 20260722000002_operational_status_machines.sql. Kept in one place so the
 * app layer's dropdowns/validation never drift from the database's allowed
 * value sets — the database is still the actual enforcement point for both
 * the value set (CHECK) and the transition (trigger).
 */
export const LEAD_TYPES = ["reservation", "order", "catering", "general"] as const;
export type LeadType = (typeof LEAD_TYPES)[number];

export const LEAD_SOURCES = ["whatsapp", "phone", "walk_in", "website", "referral", "social", "other"] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const LEAD_STATUSES = ["new", "contacted", "qualified", "converted", "lost"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const RESERVATION_STATUSES = [
  "pending",
  "confirmed",
  "seated",
  "completed",
  "cancelled",
  "no_show",
] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export const ORDER_CHANNELS = ["dine_in", "takeout", "delivery", "whatsapp", "phone", "website", "other"] as const;
export type OrderChannel = (typeof ORDER_CHANNELS)[number];

export const ORDER_FULFILLMENT_TYPES = ["dine_in", "pickup", "delivery"] as const;
export type OrderFulfillmentType = (typeof ORDER_FULFILLMENT_TYPES)[number];

export const ORDER_STATUSES = [
  "pending",
  "confirmed",
  "preparing",
  "ready",
  "out_for_delivery",
  "completed",
  "cancelled",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_PAYMENT_STATUSES = ["unpaid", "partially_paid", "paid", "refunded"] as const;
export type OrderPaymentStatus = (typeof ORDER_PAYMENT_STATUSES)[number];
