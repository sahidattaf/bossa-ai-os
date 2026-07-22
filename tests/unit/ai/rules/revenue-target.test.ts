import { describe, expect, it } from "vitest";

import { revenueTargetRule } from "@/lib/ai/rules/revenue-target";

import { emptyFacts } from "./fixtures";

const asOf = new Date("2026-07-20T12:00:00Z");

describe("revenueTargetRule", () => {
  it("produces nothing when there is no snapshot for today", () => {
    const result = revenueTargetRule.evaluate({
      facts: emptyFacts(),
      config: { dailyTarget: 500 },
      organizationId: "org-1",
      locationId: null,
      asOf,
    });

    expect(result.signals).toHaveLength(0);
  });

  it("produces nothing when revenue meets or exceeds target", () => {
    const facts = emptyFacts({
      today_kpi_snapshot: {
        id: "snap-1",
        snapshot_date: "2026-07-20",
        revenue: 600,
        average_ticket: 30,
        order_count: 20,
        reservation_count: 5,
        location_id: null,
      },
    });

    const result = revenueTargetRule.evaluate({ facts, config: { dailyTarget: 500 }, organizationId: "org-1", locationId: null, asOf });
    expect(result.signals).toHaveLength(0);
  });

  it("fires a finance-sensitive, no-approval-required recommendation when revenue is below target", () => {
    const facts = emptyFacts({
      today_kpi_snapshot: {
        id: "snap-1",
        snapshot_date: "2026-07-20",
        revenue: 67.5,
        average_ticket: 33.75,
        order_count: 2,
        reservation_count: 1,
        location_id: null,
      },
    });

    const result = revenueTargetRule.evaluate({ facts, config: { dailyTarget: 500 }, organizationId: "org-1", locationId: null, asOf });

    expect(result.signals).toHaveLength(1);
    expect(result.recommendations[0]!.requiresApproval).toBe(false);
    expect(result.recommendations[0]!.evidence[0]!.isFinanceSensitive).toBe(true);
  });
});
