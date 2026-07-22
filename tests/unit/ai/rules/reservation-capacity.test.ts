import { describe, expect, it } from "vitest";

import { reservationCapacityRule } from "@/lib/ai/rules/reservation-capacity";

import { emptyFacts } from "./fixtures";

const asOf = new Date("2026-07-20T12:00:00Z");

describe("reservationCapacityRule", () => {
  it("produces nothing below the warning percentage", () => {
    const facts = emptyFacts({
      reservations_tonight: [{ id: "r1", party_size: 10, status: "confirmed", reservation_at: "2026-07-20T19:00:00Z", location_id: null }],
    });

    const result = reservationCapacityRule.evaluate({
      facts,
      config: { capacity: 100, warningPercentage: 90 },
      organizationId: "org-1",
      locationId: null,
      asOf,
    });

    expect(result.signals).toHaveLength(0);
  });

  it("warns once covers reach the warning percentage", () => {
    const facts = emptyFacts({
      reservations_tonight: [{ id: "r1", party_size: 95, status: "confirmed", reservation_at: "2026-07-20T19:00:00Z", location_id: null }],
    });

    const result = reservationCapacityRule.evaluate({
      facts,
      config: { capacity: 100, warningPercentage: 90 },
      organizationId: "org-1",
      locationId: null,
      asOf,
    });

    expect(result.signals).toHaveLength(1);
    expect(result.signals[0]!.severity).toBe("warning");
    expect(result.recommendations[0]!.recommendedActionType).toBe("navigate");
    expect(result.recommendations[0]!.requiresApproval).toBe(false);
  });

  it("escalates to critical at or over 100% capacity", () => {
    const facts = emptyFacts({
      reservations_tonight: [{ id: "r1", party_size: 120, status: "confirmed", reservation_at: "2026-07-20T19:00:00Z", location_id: null }],
    });

    const result = reservationCapacityRule.evaluate({
      facts,
      config: { capacity: 100, warningPercentage: 90 },
      organizationId: "org-1",
      locationId: null,
      asOf,
    });

    expect(result.signals[0]!.severity).toBe("critical");
  });
});
