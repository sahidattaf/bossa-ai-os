import { z } from "zod";

import { defineRule, type RuleEvaluationResult } from "./types";

const configSchema = z.object({
  capacity: z.number().int().min(1).default(80),
  warningPercentage: z.number().min(0).max(100).default(90),
});
export type ReservationCapacityConfig = z.infer<typeof configSchema>;

export const reservationCapacityRule = defineRule<ReservationCapacityConfig>({
  ruleKey: "reservation_capacity.v1",
  scope: "location",
  configSchema,
  defaultConfig: { capacity: 80, warningPercentage: 90 },
  evaluate({ facts, config, asOf, locationId }): RuleEvaluationResult {
    const covers = facts.reservations_tonight.reduce((sum, r) => sum + (r.party_size ?? 0), 0);
    const percentage = (covers / config.capacity) * 100;

    if (percentage < config.warningPercentage) {
      return { signals: [], recommendations: [] };
    }

    const dateKey = asOf.toISOString().slice(0, 10);
    const dedupeKey = `reservation_capacity:${locationId ?? "org"}:${dateKey}`;

    return {
      signals: [
        {
          signalType: "reservation_capacity_warning",
          locationId: locationId ?? undefined,
          severity: percentage >= 100 ? "critical" : "warning",
          title: `Reservations tonight at ${Math.round(percentage)}% of capacity`,
          facts: { covers, capacity: config.capacity, percentage },
          dedupeKey,
        },
      ],
      recommendations: [
        {
          dedupeKey: `review_capacity:${locationId ?? "org"}:${dateKey}`,
          locationId: locationId ?? undefined,
          recommendationType: "reservation_capacity_review",
          title: "Reservations tonight are near capacity",
          executiveSummary: `${covers} covers booked against a capacity of ${config.capacity} (${Math.round(percentage)}%). Review tonight's reservations.`,
          severity: percentage >= 100 ? "critical" : "warning",
          priorityScore: percentage >= 100 ? 90 : 65,
          recommendedActionType: "navigate",
          recommendedActionPayload: { route: "/reservations", label: "Review tonight's reservations" },
          expectedBenefit: "Avoid overbooking or turning away walk-ins unnecessarily.",
          riskLevel: "low",
          requiresApproval: false,
          ruleId: "reservation_capacity.v1",
          evidence: [
            {
              metricName: "covers_tonight",
              observedValue: { covers },
              expectedValue: { capacity: config.capacity, warningPercentage: config.warningPercentage },
              calculationDefinition: "sum(reservations.party_size) where reservation_at::date = today and status not in (cancelled, no_show)",
              isFinanceSensitive: false,
            },
          ],
        },
      ],
    };
  },
});
