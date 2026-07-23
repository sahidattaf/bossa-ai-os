import { z } from "zod";

import { defineRule, type RuleEvaluationResult } from "./types";

const configSchema = z.object({
  maxStaleDays: z.number().int().min(0).default(2),
});
export type KpiStalenessConfig = z.infer<typeof configSchema>;

function daysBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / (24 * 60 * 60 * 1000);
}

export const kpiStalenessRule = defineRule<KpiStalenessConfig>({
  ruleKey: "kpi_staleness.v1",
  scope: "both",
  configSchema,
  defaultConfig: { maxStaleDays: 2 },
  evaluate({ facts, config, asOf, locationId, organizationId }): RuleEvaluationResult {
    const snapshot = facts.latest_kpi_snapshot;
    const staleDays = snapshot ? daysBetween(asOf, new Date(snapshot.snapshot_date)) : Number.POSITIVE_INFINITY;

    if (staleDays <= config.maxStaleDays) {
      return { signals: [], recommendations: [] };
    }

    const dateKey = asOf.toISOString().slice(0, 10);

    return {
      signals: [
        {
          signalType: "kpi_snapshot_stale",
          locationId: locationId ?? undefined,
          severity: "warning",
          title: snapshot ? `Last KPI snapshot is ${Math.floor(staleDays)} day(s) old` : "No KPI snapshot has ever been generated",
          facts: { lastSnapshotDate: snapshot?.snapshot_date ?? null, staleDays: Number.isFinite(staleDays) ? Math.floor(staleDays) : null },
          dedupeKey: `kpi_snapshot_stale:${locationId ?? "org"}`,
        },
      ],
      recommendations: [
        {
          dedupeKey: `regenerate_kpi_snapshot:${locationId ?? "org"}:${dateKey}`,
          locationId: locationId ?? undefined,
          recommendationType: "kpi_snapshot_stale",
          title: "Regenerate today's KPI snapshot",
          executiveSummary: snapshot
            ? `The most recent KPI snapshot is ${Math.floor(staleDays)} day(s) old — dashboard trends may be out of date.`
            : `Organization ${organizationId} has no KPI snapshot yet.`,
          severity: "warning",
          priorityScore: 45,
          recommendedActionType: "regenerate_kpi_snapshot",
          recommendedActionPayload: { date: dateKey, locationId: locationId ?? null },
          expectedBenefit: "Keeps the dashboard's revenue trend and forecast accurate.",
          riskLevel: "low",
          requiresApproval: true,
          ruleId: "kpi_staleness.v1",
          evidence: [
            {
              metricName: "kpi_snapshot_age_days",
              observedValue: { lastSnapshotDate: snapshot?.snapshot_date ?? null },
              expectedValue: { maxStaleDays: config.maxStaleDays },
              calculationDefinition: "days since the most recent daily_kpi_snapshots row for this organization/location",
              isFinanceSensitive: false,
            },
          ],
        },
      ],
    };
  },
});
