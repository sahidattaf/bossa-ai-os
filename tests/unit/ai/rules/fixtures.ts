import type { EvaluationFacts } from "@/lib/ai/rules/types";

export function emptyFacts(overrides: Partial<EvaluationFacts> = {}): EvaluationFacts {
  return {
    as_of: "2026-07-20T12:00:00Z",
    open_leads: [],
    reservations_tonight: [],
    recent_reservation_attrition: [],
    open_orders: [],
    latest_kpi_snapshot: null,
    today_kpi_snapshot: null,
    ...overrides,
  };
}
