import { z } from "zod";

import { defineRule, type RuleEvaluationResult } from "./types";

const configSchema = z.object({
  maxRecentCancellations: z.number().int().min(0).default(3),
});
export type ReservationAttritionConfig = z.infer<typeof configSchema>;

export const reservationAttritionRule = defineRule<ReservationAttritionConfig>({
  ruleKey: "reservation_attrition.v1",
  configSchema,
  defaultConfig: { maxRecentCancellations: 3 },
  evaluate({ facts, config, asOf, locationId }): RuleEvaluationResult {
    const attrition = facts.recent_reservation_attrition;
    if (attrition.length <= config.maxRecentCancellations) {
      return { signals: [], recommendations: [] };
    }

    const dateKey = asOf.toISOString().slice(0, 10);
    const dedupeKey = `reservation_attrition:${locationId ?? "org"}`;
    const noShows = attrition.filter((r) => r.status === "no_show").length;
    const cancellations = attrition.length - noShows;

    return {
      signals: [
        {
          signalType: "reservation_attrition_increase",
          locationId: locationId ?? undefined,
          severity: "warning",
          title: `${attrition.length} cancellations/no-shows in the last 14 days`,
          facts: { total: attrition.length, cancellations, noShows },
          dedupeKey,
        },
      ],
      recommendations: [
        {
          dedupeKey: `review_attrition:${locationId ?? "org"}:${dateKey}`,
          locationId: locationId ?? undefined,
          recommendationType: "reservation_attrition_review",
          title: "Cancellations and no-shows are trending up",
          executiveSummary: `${cancellations} cancellations and ${noShows} no-shows in the last 14 days, above the configured threshold of ${config.maxRecentCancellations}.`,
          severity: "warning",
          priorityScore: 55,
          recommendedActionType: "navigate",
          recommendedActionPayload: { route: "/reservations", label: "Review recent reservations" },
          expectedBenefit: "Identify whether a confirmation/reminder process gap is causing attrition.",
          riskLevel: "low",
          requiresApproval: false,
          ruleId: "reservation_attrition.v1",
          evidence: [
            {
              metricName: "recent_cancellations_and_no_shows",
              observedValue: { count: attrition.length },
              expectedValue: { maxRecentCancellations: config.maxRecentCancellations },
              calculationDefinition: "count(reservations where status in (cancelled, no_show) and reservation_at within last 14 days)",
              isFinanceSensitive: false,
            },
          ],
        },
      ],
    };
  },
});
