import { z } from "zod";

import { defineRule, type RuleEvaluationResult } from "./types";

const configSchema = z.object({
  maxAgeHours: z.number().min(0).default(24),
  defaultOwnerUserId: z.string().uuid().optional(),
});
export type AgingLeadsConfig = z.infer<typeof configSchema>;

export const agingLeadsRule = defineRule<AgingLeadsConfig>({
  ruleKey: "aging_leads.v1",
  scope: "location",
  configSchema,
  defaultConfig: { maxAgeHours: 24 },
  evaluate({ facts, config, asOf, locationId }): RuleEvaluationResult {
    const maxAgeMs = config.maxAgeHours * 60 * 60 * 1000;
    const aging = facts.open_leads.filter(
      (lead) => lead.owner_user_id === null && asOf.getTime() - new Date(lead.created_at).getTime() > maxAgeMs,
    );

    if (aging.length === 0) {
      return { signals: [], recommendations: [] };
    }

    const signals = aging.map((lead) => ({
      signalType: "aging_lead",
      locationId: lead.location_id ?? locationId ?? undefined,
      severity: "warning" as const,
      title: `${lead.contact_name} has had no owner for over ${config.maxAgeHours}h`,
      facts: { created_at: lead.created_at, status: lead.status },
      dedupeKey: `aging_lead:${lead.id}`,
      sourceEntityType: "lead" as const,
      sourceEntityId: lead.id,
    }));

    const recommendations = config.defaultOwnerUserId
      ? aging.slice(0, 5).map((lead) => ({
          dedupeKey: `assign_lead_owner:${lead.id}`,
          locationId: lead.location_id ?? undefined,
          recommendationType: "aging_lead_followup",
          title: `Assign an owner to ${lead.contact_name}`,
          executiveSummary: `${lead.contact_name} has gone unowned for more than ${config.maxAgeHours} hours.`,
          severity: "warning" as const,
          priorityScore: 60,
          recommendedActionType: "assign_lead_owner" as const,
          recommendedActionPayload: { leadId: lead.id, ownerUserId: config.defaultOwnerUserId! },
          expectedBenefit: "Prevents the lead from going cold.",
          riskLevel: "low" as const,
          requiresApproval: true,
          ruleId: "aging_leads.v1",
          evidence: [
            {
              metricName: "lead_age_hours",
              observedValue: { hours: Math.round((asOf.getTime() - new Date(lead.created_at).getTime()) / 3_600_000) },
              expectedValue: { maxAgeHours: config.maxAgeHours },
              sourceEntityType: "lead" as const,
              sourceEntityId: lead.id,
              calculationDefinition: "hours since leads.created_at, owner_user_id is null",
              isFinanceSensitive: false,
            },
          ],
        }))
      : [];

    return { signals, recommendations };
  },
});
