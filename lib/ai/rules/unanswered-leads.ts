import { z } from "zod";

import { defineRule, type RuleEvaluationResult } from "./types";

const configSchema = z.object({
  maxUnanswered: z.number().int().min(0).default(3),
  defaultOwnerUserId: z.string().uuid().optional(),
});
export type UnansweredLeadsConfig = z.infer<typeof configSchema>;

export const unansweredLeadsRule = defineRule<UnansweredLeadsConfig>({
  ruleKey: "unanswered_leads.v1",
  configSchema,
  defaultConfig: { maxUnanswered: 3 },
  evaluate({ facts, config, locationId }): RuleEvaluationResult {
    const unanswered = facts.open_leads.filter((lead) => lead.status === "new");

    if (unanswered.length <= config.maxUnanswered) {
      return { signals: [], recommendations: [] };
    }

    const dedupeKey = `unanswered_leads:${locationId ?? "org"}`;
    const severity = unanswered.length >= config.maxUnanswered * 2 ? "critical" : "warning";

    const recommendations = config.defaultOwnerUserId
      ? unanswered.slice(0, 5).map((lead) => ({
          dedupeKey: `assign_lead_owner:${lead.id}`,
          locationId: lead.location_id ?? undefined,
          recommendationType: "unanswered_lead_followup",
          title: `Follow up with ${lead.contact_name}`,
          executiveSummary: `${lead.contact_name} has no assigned owner and is still unanswered.`,
          severity: "warning" as const,
          priorityScore: 70,
          recommendedActionType: "assign_lead_owner" as const,
          recommendedActionPayload: { leadId: lead.id, ownerUserId: config.defaultOwnerUserId! },
          expectedBenefit: "Faster first response, lower risk of losing the lead.",
          riskLevel: "low" as const,
          requiresApproval: true,
          ruleId: "unanswered_leads.v1",
          evidence: [
            {
              metricName: "lead_status",
              observedValue: { status: lead.status, created_at: lead.created_at },
              sourceEntityType: "lead" as const,
              sourceEntityId: lead.id,
              calculationDefinition: 'leads.status = "new" with no owner_user_id',
              isFinanceSensitive: false,
            },
          ],
        }))
      : [];

    return {
      signals: [
        {
          signalType: "unanswered_leads",
          locationId: locationId ?? undefined,
          severity,
          title: `${unanswered.length} unanswered lead${unanswered.length === 1 ? "" : "s"}`,
          facts: { count: unanswered.length, leadIds: unanswered.map((l) => l.id) },
          dedupeKey,
        },
      ],
      recommendations,
    };
  },
});
