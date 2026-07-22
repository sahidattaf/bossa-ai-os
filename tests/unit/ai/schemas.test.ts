import { describe, expect, it } from "vitest";

import { recommendationIntentSchema } from "@/lib/ai/schemas";

const baseRecommendation = {
  dedupeKey: "test:1",
  recommendationType: "unanswered_lead_followup",
  title: "Follow up",
  executiveSummary: "Summary",
  severity: "warning" as const,
  recommendedActionType: "assign_lead_owner" as const,
  ruleId: "unanswered_leads.v1",
  evidence: [],
};

describe("recommendationIntentSchema", () => {
  it("accepts a payload that matches its declared action type's schema", () => {
    const result = recommendationIntentSchema.safeParse({
      ...baseRecommendation,
      recommendedActionPayload: { leadId: "11111111-1111-1111-1111-111111111111", ownerUserId: "22222222-2222-2222-2222-222222222222" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a payload that does not match its declared action type's schema", () => {
    const result = recommendationIntentSchema.safeParse({
      ...baseRecommendation,
      recommendedActionPayload: { totallyWrongField: true },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a navigate payload without a route starting with '/'", () => {
    const result = recommendationIntentSchema.safeParse({
      ...baseRecommendation,
      recommendedActionType: "navigate",
      recommendedActionPayload: { route: "not-a-path" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown action type outright", () => {
    const result = recommendationIntentSchema.safeParse({
      ...baseRecommendation,
      recommendedActionType: "delete_everything",
      recommendedActionPayload: {},
    });
    expect(result.success).toBe(false);
  });
});
