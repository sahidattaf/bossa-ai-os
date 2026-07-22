import { z } from "zod";

import { defineRule, type RuleEvaluationResult } from "./types";

const configSchema = z.object({
  maxUnpaidAgeHours: z.number().min(0).default(24),
});
export type StalledOrdersConfig = z.infer<typeof configSchema>;

export const stalledOrdersRule = defineRule<StalledOrdersConfig>({
  ruleKey: "stalled_orders.v1",
  configSchema,
  defaultConfig: { maxUnpaidAgeHours: 24 },
  evaluate({ facts, config, asOf, locationId }): RuleEvaluationResult {
    const maxAgeMs = config.maxUnpaidAgeHours * 60 * 60 * 1000;
    const stalled = facts.open_orders.filter(
      (order) => order.payment_status === "unpaid" && asOf.getTime() - new Date(order.created_at).getTime() > maxAgeMs,
    );

    if (stalled.length === 0) {
      return { signals: [], recommendations: [] };
    }

    const signals = stalled.map((order) => ({
      signalType: "unpaid_order",
      locationId: order.location_id ?? locationId ?? undefined,
      severity: "warning" as const,
      title: `Order ${order.order_number} is unpaid after ${config.maxUnpaidAgeHours}h`,
      facts: { total: order.total, created_at: order.created_at },
      dedupeKey: `unpaid_order:${order.id}`,
      sourceEntityType: "order" as const,
      sourceEntityId: order.id,
    }));

    // Informational only — a rule cannot safely infer payment was actually
    // collected, so it directs a human to review rather than auto-marking paid.
    const recommendations = stalled.slice(0, 5).map((order) => ({
      dedupeKey: `review_unpaid_order:${order.id}`,
      locationId: order.location_id ?? undefined,
      recommendationType: "unpaid_order_review",
      title: `Follow up on unpaid order ${order.order_number}`,
      executiveSummary: `Order ${order.order_number} (${order.total}) has been unpaid for more than ${config.maxUnpaidAgeHours} hours.`,
      severity: "warning" as const,
      priorityScore: 65,
      recommendedActionType: "navigate" as const,
      recommendedActionPayload: { route: `/orders/${order.id}`, label: "Review order" },
      expectedBenefit: "Collect payment or resolve the order before it goes further stale.",
      riskLevel: "low" as const,
      requiresApproval: false,
      ruleId: "stalled_orders.v1",
      evidence: [
        {
          metricName: "order_unpaid_age_hours",
          observedValue: { hours: Math.round((asOf.getTime() - new Date(order.created_at).getTime()) / 3_600_000), total: order.total },
          expectedValue: { maxUnpaidAgeHours: config.maxUnpaidAgeHours },
          sourceEntityType: "order" as const,
          sourceEntityId: order.id,
          calculationDefinition: "hours since orders.created_at, payment_status = unpaid",
          isFinanceSensitive: true,
        },
      ],
    }));

    return { signals, recommendations };
  },
});
