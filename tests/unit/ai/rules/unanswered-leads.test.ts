import { describe, expect, it } from "vitest";

import { unansweredLeadsRule } from "@/lib/ai/rules/unanswered-leads";

import { emptyFacts } from "./fixtures";

const asOf = new Date("2026-07-20T12:00:00Z");

describe("unansweredLeadsRule", () => {
  it("produces no signal when the unanswered count is at or below the threshold", () => {
    const facts = emptyFacts({
      open_leads: [
        { id: "lead-1", contact_name: "A", created_at: "2026-07-20T09:00:00Z", status: "new", owner_user_id: null, location_id: null },
      ],
    });

    const result = unansweredLeadsRule.evaluate({
      facts,
      config: { maxUnanswered: 3 },
      organizationId: "org-1",
      locationId: null,
      asOf,
    });

    expect(result.signals).toHaveLength(0);
    expect(result.recommendations).toHaveLength(0);
  });

  it("produces a signal once the unanswered count exceeds the threshold", () => {
    const facts = emptyFacts({
      open_leads: Array.from({ length: 4 }, (_, i) => ({
        id: `lead-${i}`,
        contact_name: `Lead ${i}`,
        created_at: "2026-07-20T09:00:00Z",
        status: "new",
        owner_user_id: null,
        location_id: null,
      })),
    });

    const result = unansweredLeadsRule.evaluate({
      facts,
      config: { maxUnanswered: 3 },
      organizationId: "org-1",
      locationId: null,
      asOf,
    });

    expect(result.signals).toHaveLength(1);
    expect(result.signals[0]!.dedupeKey).toBe("unanswered_leads:org");
    expect(result.signals[0]!.facts).toEqual({ count: 4, leadIds: facts.open_leads.map((l) => l.id) });
  });

  it("only proposes assign_lead_owner recommendations when a default owner is configured", () => {
    const facts = emptyFacts({
      open_leads: Array.from({ length: 4 }, (_, i) => ({
        id: `lead-${i}`,
        contact_name: `Lead ${i}`,
        created_at: "2026-07-20T09:00:00Z",
        status: "new",
        owner_user_id: null,
        location_id: null,
      })),
    });

    const withoutDefaultOwner = unansweredLeadsRule.evaluate({
      facts,
      config: { maxUnanswered: 3 },
      organizationId: "org-1",
      locationId: null,
      asOf,
    });
    expect(withoutDefaultOwner.recommendations).toHaveLength(0);

    const withDefaultOwner = unansweredLeadsRule.evaluate({
      facts,
      config: { maxUnanswered: 3, defaultOwnerUserId: "11111111-1111-1111-1111-111111111111" },
      organizationId: "org-1",
      locationId: null,
      asOf,
    });
    expect(withDefaultOwner.recommendations.length).toBeGreaterThan(0);
    expect(withDefaultOwner.recommendations[0]!.recommendedActionType).toBe("assign_lead_owner");
    expect(withDefaultOwner.recommendations[0]!.recommendedActionPayload).toMatchObject({
      ownerUserId: "11111111-1111-1111-1111-111111111111",
    });
  });

  it("ignores leads that are not in status 'new'", () => {
    const facts = emptyFacts({
      open_leads: [
        { id: "lead-1", contact_name: "A", created_at: "2026-07-20T09:00:00Z", status: "contacted", owner_user_id: null, location_id: null },
      ],
    });

    const result = unansweredLeadsRule.evaluate({
      facts,
      config: { maxUnanswered: 0 },
      organizationId: "org-1",
      locationId: null,
      asOf,
    });

    expect(result.signals).toHaveLength(0);
  });
});
