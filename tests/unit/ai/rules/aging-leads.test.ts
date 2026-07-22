import { describe, expect, it } from "vitest";

import { agingLeadsRule } from "@/lib/ai/rules/aging-leads";

import { emptyFacts } from "./fixtures";

const asOf = new Date("2026-07-20T12:00:00Z");

describe("agingLeadsRule", () => {
  it("ignores leads younger than the configured max age", () => {
    const facts = emptyFacts({
      open_leads: [
        { id: "lead-1", contact_name: "Fresh", created_at: "2026-07-20T11:00:00Z", status: "new", owner_user_id: null, location_id: null },
      ],
    });

    const result = agingLeadsRule.evaluate({
      facts,
      config: { maxAgeHours: 24 },
      organizationId: "org-1",
      locationId: null,
      asOf,
    });

    expect(result.signals).toHaveLength(0);
  });

  it("flags leads older than the configured max age with no owner", () => {
    const facts = emptyFacts({
      open_leads: [
        { id: "lead-1", contact_name: "Stale", created_at: "2026-07-18T12:00:00Z", status: "contacted", owner_user_id: null, location_id: null },
      ],
    });

    const result = agingLeadsRule.evaluate({
      facts,
      config: { maxAgeHours: 24 },
      organizationId: "org-1",
      locationId: null,
      asOf,
    });

    expect(result.signals).toHaveLength(1);
    expect(result.signals[0]!.dedupeKey).toBe("aging_lead:lead-1");
    expect(result.signals[0]!.sourceEntityId).toBe("lead-1");
  });

  it("ignores aging leads that already have an owner", () => {
    const facts = emptyFacts({
      open_leads: [
        {
          id: "lead-1",
          contact_name: "Owned",
          created_at: "2026-07-18T12:00:00Z",
          status: "contacted",
          owner_user_id: "22222222-2222-2222-2222-222222222222",
          location_id: null,
        },
      ],
    });

    const result = agingLeadsRule.evaluate({
      facts,
      config: { maxAgeHours: 24 },
      organizationId: "org-1",
      locationId: null,
      asOf,
    });

    expect(result.signals).toHaveLength(0);
  });
});
