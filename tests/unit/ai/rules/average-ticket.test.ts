import { describe, expect, it } from "vitest";

import { averageTicketRule } from "@/lib/ai/rules/average-ticket";

import { emptyFacts } from "./fixtures";

const asOf = new Date("2026-07-20T12:00:00Z");

describe("averageTicketRule", () => {
  it("produces nothing when there are no orders yet today", () => {
    const facts = emptyFacts({
      today_kpi_snapshot: {
        id: "snap-1",
        snapshot_date: "2026-07-20",
        revenue: 0,
        average_ticket: 0,
        order_count: 0,
        reservation_count: 0,
        location_id: null,
      },
    });

    const result = averageTicketRule.evaluate({ facts, config: { targetAverageTicket: 25 }, organizationId: "org-1", locationId: null, asOf });
    expect(result.signals).toHaveLength(0);
  });

  it("fires when the average ticket is below target", () => {
    const facts = emptyFacts({
      today_kpi_snapshot: {
        id: "snap-1",
        snapshot_date: "2026-07-20",
        revenue: 40,
        average_ticket: 20,
        order_count: 2,
        reservation_count: 0,
        location_id: null,
      },
    });

    const result = averageTicketRule.evaluate({ facts, config: { targetAverageTicket: 25 }, organizationId: "org-1", locationId: null, asOf });
    expect(result.signals).toHaveLength(1);
  });
});
