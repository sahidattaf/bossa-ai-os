import type { z } from "zod";

import type { RecommendationIntent, SignalIntent } from "../schemas";

/** One row from get_ai_evaluation_facts()'s open_leads array. */
export interface LeadFact {
  id: string;
  contact_name: string;
  created_at: string;
  status: string;
  owner_user_id: string | null;
  location_id: string | null;
}

/** One row from get_ai_evaluation_facts()'s reservations_tonight / recent_reservation_attrition arrays. */
export interface ReservationFact {
  id: string;
  party_size?: number;
  status: string;
  reservation_at: string;
  location_id: string | null;
}

/** One row from get_ai_evaluation_facts()'s open_orders array. */
export interface OrderFact {
  id: string;
  order_number: string;
  status: string;
  payment_status: string;
  total: number;
  created_at: string;
  updated_at: string;
  location_id: string | null;
}

export interface KpiSnapshotFact {
  id: string;
  snapshot_date: string;
  revenue: number;
  average_ticket: number;
  order_count: number;
  reservation_count: number;
  location_id: string | null;
}

/** Exact shape returned by public.get_ai_evaluation_facts(). */
export interface EvaluationFacts {
  as_of: string;
  open_leads: LeadFact[];
  reservations_tonight: ReservationFact[];
  recent_reservation_attrition: ReservationFact[];
  open_orders: OrderFact[];
  latest_kpi_snapshot: KpiSnapshotFact | null;
  today_kpi_snapshot: KpiSnapshotFact | null;
}

export interface RuleContext<TConfig> {
  facts: EvaluationFacts;
  config: TConfig;
  organizationId: string;
  locationId: string | null;
  asOf: Date;
}

export interface RuleEvaluationResult {
  signals: SignalIntent[];
  recommendations: RecommendationIntent[];
}

export interface RuleDefinition<TConfig> {
  ruleKey: string;
  // Input is loosened to `any`: every config schema here uses zod `.default()`
  // fields, which makes their real Input type (optional fields) differ from
  // their Output type (TConfig, defaults applied) — `z.ZodType<TConfig>`'s
  // default Input=TConfig would reject that. The values these schemas parse
  // are always `unknown` jsonb from the database anyway, so nothing is lost
  // by not pinning Input precisely.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  configSchema: z.ZodType<TConfig, z.ZodTypeDef, any>;
  defaultConfig: TConfig;
  evaluate(context: RuleContext<TConfig>): RuleEvaluationResult;
}

/** Type-erased view used by the registry, which must hold rules with different config shapes. */
export type AnyRuleDefinition = RuleDefinition<unknown>;

export function defineRule<TConfig>(definition: RuleDefinition<TConfig>): AnyRuleDefinition {
  return definition as AnyRuleDefinition;
}
