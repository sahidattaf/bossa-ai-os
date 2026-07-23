import { z } from "zod";

import { defineRule, type RuleEvaluationResult } from "./types";

const configSchema = z.object({
  maxPreparingMinutes: z.number().min(0).default(30),
  maxReadyMinutes: z.number().min(0).default(15),
});
export type DelayedOrdersConfig = z.infer<typeof configSchema>;

export const delayedOrdersRule = defineRule<DelayedOrdersConfig>({
  ruleKey: "delayed_orders.v1",
  scope: "location",
  configSchema,
  defaultConfig: { maxPreparingMinutes: 30, maxReadyMinutes: 15 },
  evaluate({ facts, config, asOf, locationId }): RuleEvaluationResult {
    const nowMs = asOf.getTime();
    const delayed = facts.open_orders.filter((order) => {
      const ageMinutes = (nowMs - new Date(order.updated_at).getTime()) / 60_000;
      if (order.status === "preparing") return ageMinutes > config.maxPreparingMinutes;
      if (order.status === "ready") return ageMinutes > config.maxReadyMinutes;
      return false;
    });

    if (delayed.length === 0) {
      return { signals: [], recommendations: [] };
    }

    const signals = delayed.map((order) => ({
      signalType: "delayed_order",
      locationId: order.location_id ?? locationId ?? undefined,
      severity: "warning" as const,
      title: `Order ${order.order_number} has been "${order.status}" too long`,
      facts: { status: order.status, updated_at: order.updated_at },
      dedupeKey: `delayed_order:${order.id}`,
      sourceEntityType: "order" as const,
      sourceEntityId: order.id,
    }));

    const recommendations = delayed.slice(0, 5).map((order) => ({
      dedupeKey: `review_delayed_order:${order.id}`,
      locationId: order.location_id ?? undefined,
      recommendationType: "delayed_order_review",
      title: `Check on order ${order.order_number}`,
      executiveSummary: `Order ${order.order_number} has been stuck in "${order.status}" longer than expected.`,
      severity: "warning" as const,
      priorityScore: 60,
      recommendedActionType: "navigate" as const,
      recommendedActionPayload: { route: `/orders/${order.id}`, label: "Review order" },
      expectedBenefit: "Prevents a cold or forgotten order from reaching the guest late.",
      riskLevel: "low" as const,
      requiresApproval: false,
      ruleId: "delayed_orders.v1",
      evidence: [
        {
          metricName: "order_status_age_minutes",
          observedValue: { status: order.status, minutes: Math.round((nowMs - new Date(order.updated_at).getTime()) / 60_000) },
          expectedValue:
            order.status === "preparing"
              ? { maxPreparingMinutes: config.maxPreparingMinutes }
              : { maxReadyMinutes: config.maxReadyMinutes },
          sourceEntityType: "order" as const,
          sourceEntityId: order.id,
          calculationDefinition: "minutes since orders.updated_at for status in (preparing, ready)",
          isFinanceSensitive: false,
        },
      ],
    }));

    return { signals, recommendations };
  },
});
