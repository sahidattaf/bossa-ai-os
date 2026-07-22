import { describe, expect, it } from "vitest";

import { reservationAttritionRule } from "@/lib/ai/rules/reservation-attrition";

import { emptyFacts } from "./fixtures";

const asOf = new Date("2026-07-20T12:00:00Z");

describe("reservationAttritionRule", () => {
  it("stays quiet at or below the configured threshold", () => {
    const facts = emptyFacts({
      recent_reservation_attrition: [
        { id: "r1", status: "cancelled", reservation_at: "2026-07-19T19:00:00Z", location_id: null },
        { id: "r2", status: "no_show", reservation_at: "2026-07-18T19:00:00Z", location_id: null },
      ],
    });

    const result = reservationAttritionRule.evaluate({
      facts,
      config: { maxRecentCancellations: 3 },
      organizationId: "org-1",
      locationId: null,
      asOf,
    });

    expect(result.signals).toHaveLength(0);
  });

  it("fires once attrition exceeds the threshold, splitting cancellations from no-shows", () => {
    const facts = emptyFacts({
      recent_reservation_attrition: [
        { id: "r1", status: "cancelled", reservation_at: "2026-07-19T19:00:00Z", location_id: null },
        { id: "r2", status: "cancelled", reservation_at: "2026-07-18T19:00:00Z", location_id: null },
        { id: "r3", status: "no_show", reservation_at: "2026-07-17T19:00:00Z", location_id: null },
        { id: "r4", status: "no_show", reservation_at: "2026-07-16T19:00:00Z", location_id: null },
      ],
    });

    const result = reservationAttritionRule.evaluate({
      facts,
      config: { maxRecentCancellations: 3 },
      organizationId: "org-1",
      locationId: null,
      asOf,
    });

    expect(result.signals).toHaveLength(1);
    expect(result.signals[0]!.facts).toEqual({ total: 4, cancellations: 2, noShows: 2 });
  });
});
