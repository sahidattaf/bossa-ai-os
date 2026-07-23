import { z } from "zod";

import { defineRule, type RuleEvaluationResult } from "./types";

const configSchema = z.object({
  dailyTarget: z.number().min(0).default(500),
});
export type RevenueTargetConfig = z.infer<typeof configSchema>;

export const revenueTargetRule = defineRule<RevenueTargetConfig>({
  ruleKey: "revenue_target.v1",
  scope: "both",
  configSchema,
  defaultConfig: { dailyTarget: 500 },
  evaluate({ facts, config, asOf, locationId }): RuleEvaluationResult {
    const snapshot = facts.today_kpi_snapshot;
    if (!snapshot || snapshot.revenue >= config.dailyTarget) {
      return { signals: [], recommendations: [] };
    }

    const dateKey = asOf.toISOString().slice(0, 10);

    return {
      signals: [
        {
          signalType: "revenue_below_target",
          locationId: locationId ?? undefined,
          severity: "info",
          title: "Revenue is trailing today's target",
          // Signal facts are visible to any ai.executive.read holder with no
          // finance-sensitive redaction (unlike ai_recommendation_evidence,
          // which is gated by finance.read at the RLS layer) — the actual
          // revenue figure lives only in this recommendation's evidence row
          // below, marked isFinanceSensitive: true.
          facts: { belowTarget: true },
          dedupeKey: `revenue_below_target:${locationId ?? "org"}:${dateKey}`,
          sourceEntityType: "daily_kpi_snapshot",
          sourceEntityId: snapshot.id,
        },
      ],
      recommendations: [
        {
          dedupeKey: `revenue_below_target_review:${locationId ?? "org"}:${dateKey}`,
          locationId: locationId ?? undefined,
          recommendationType: "revenue_below_target",
          title: "Revenue is trailing target today",
          executiveSummary: `Today's revenue is below the configured daily target. Review the Finance module for detail.`,
          severity: "info",
          priorityScore: 30,
          recommendedActionType: "navigate",
          recommendedActionPayload: { route: "/finance", label: "Review finance" },
          expectedBenefit: "Owner awareness of a revenue shortfall while there's still time to act today.",
          riskLevel: "low",
          requiresApproval: false,
          ruleId: "revenue_target.v1",
          evidence: [
            {
              metricName: "revenue_today",
              observedValue: { amount: snapshot.revenue },
              expectedValue: { target: config.dailyTarget },
              sourceEntityType: "daily_kpi_snapshot",
              sourceEntityId: snapshot.id,
              calculationDefinition: "daily_kpi_snapshots.revenue for snapshot_date = today",
              isFinanceSensitive: true,
            },
          ],
        },
      ],
    };
  },
});
