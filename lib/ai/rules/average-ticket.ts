import { z } from "zod";

import { defineRule, type RuleEvaluationResult } from "./types";

const configSchema = z.object({
  targetAverageTicket: z.number().min(0).default(25),
});
export type AverageTicketConfig = z.infer<typeof configSchema>;

export const averageTicketRule = defineRule<AverageTicketConfig>({
  ruleKey: "average_ticket.v1",
  configSchema,
  defaultConfig: { targetAverageTicket: 25 },
  evaluate({ facts, config, asOf, locationId }): RuleEvaluationResult {
    const snapshot = facts.today_kpi_snapshot;
    if (!snapshot || snapshot.order_count === 0 || snapshot.average_ticket >= config.targetAverageTicket) {
      return { signals: [], recommendations: [] };
    }

    const dateKey = asOf.toISOString().slice(0, 10);

    return {
      signals: [
        {
          signalType: "average_ticket_below_target",
          locationId: locationId ?? undefined,
          severity: "info",
          title: "Average ticket is below target today",
          // See revenue-target.ts's identical comment: signal facts have no
          // finance.read redaction, so the actual figure lives only in this
          // recommendation's isFinanceSensitive evidence row.
          facts: { belowTarget: true },
          dedupeKey: `average_ticket_below_target:${locationId ?? "org"}:${dateKey}`,
          sourceEntityType: "daily_kpi_snapshot",
          sourceEntityId: snapshot.id,
        },
      ],
      recommendations: [
        {
          dedupeKey: `average_ticket_review:${locationId ?? "org"}:${dateKey}`,
          locationId: locationId ?? undefined,
          recommendationType: "average_ticket_below_target",
          title: "Average ticket is below target",
          executiveSummary: "Today's average ticket is trailing target. Consider an upsell prompt or bundle offer.",
          severity: "info",
          priorityScore: 25,
          recommendedActionType: "navigate",
          recommendedActionPayload: { route: "/finance", label: "Review finance" },
          expectedBenefit: "Owner awareness of a per-check revenue gap.",
          riskLevel: "low",
          requiresApproval: false,
          ruleId: "average_ticket.v1",
          evidence: [
            {
              metricName: "average_ticket_today",
              observedValue: { amount: snapshot.average_ticket },
              expectedValue: { target: config.targetAverageTicket },
              sourceEntityType: "daily_kpi_snapshot",
              sourceEntityId: snapshot.id,
              calculationDefinition: "daily_kpi_snapshots.average_ticket for snapshot_date = today",
              isFinanceSensitive: true,
            },
          ],
        },
      ],
    };
  },
});
