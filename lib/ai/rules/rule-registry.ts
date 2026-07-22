import type { AnyRuleDefinition } from "./types";

import { agingLeadsRule } from "./aging-leads";
import { averageTicketRule } from "./average-ticket";
import { delayedOrdersRule } from "./delayed-orders";
import { kpiStalenessRule } from "./kpi-staleness";
import { reservationAttritionRule } from "./reservation-attrition";
import { reservationCapacityRule } from "./reservation-capacity";
import { revenueTargetRule } from "./revenue-target";
import { stalledOrdersRule } from "./stalled-orders";
import { unansweredLeadsRule } from "./unanswered-leads";

/**
 * Every deterministic rule family this phase ships (issue #18 scope 1: 9
 * signal families, minus "operational database/provider failure" — that one
 * is synthesized by lib/ai/evaluate.ts when fact-gathering itself throws,
 * not by a rule evaluated against successfully-gathered facts).
 */
export const RULE_REGISTRY: readonly AnyRuleDefinition[] = [
  unansweredLeadsRule,
  agingLeadsRule,
  reservationCapacityRule,
  reservationAttritionRule,
  stalledOrdersRule,
  delayedOrdersRule,
  revenueTargetRule,
  averageTicketRule,
  kpiStalenessRule,
];

export function getRuleByKey(ruleKey: string): AnyRuleDefinition | undefined {
  return RULE_REGISTRY.find((rule) => rule.ruleKey === ruleKey);
}
