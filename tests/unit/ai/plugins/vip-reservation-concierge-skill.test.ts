import { describe, expect, it } from "vitest";

import { vipReservationConciergeSkill } from "@/lib/ai/plugins/skills/vip-reservation-concierge-skill";

import { emptyFacts } from "../rules/fixtures";

const asOf = new Date("2026-07-20T12:00:00Z");

describe("vipReservationConciergeSkill", () => {
  it("proposes nothing for small parties", () => {
    const facts = emptyFacts({
      reservations_tonight: [{ id: "r1", party_size: 2, status: "confirmed", reservation_at: "2026-07-20T19:00:00Z", location_id: null }],
    });

    const proposals = vipReservationConciergeSkill.propose({ organizationId: "org-1", locationId: null, asOf, facts });
    expect(proposals).toHaveLength(0);
  });

  it("proposes a read-only navigate recommendation for a large party", () => {
    const facts = emptyFacts({
      reservations_tonight: [{ id: "r1", party_size: 8, status: "confirmed", reservation_at: "2026-07-20T19:00:00Z", location_id: null }],
    });

    const proposals = vipReservationConciergeSkill.propose({ organizationId: "org-1", locationId: null, asOf, facts });
    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.recommendedActionType).toBe("navigate");
    expect(proposals[0]!.requiresApproval).toBe(false);
    expect(proposals[0]!.evidence[0]!.sourceEntityId).toBe("r1");
  });
});
