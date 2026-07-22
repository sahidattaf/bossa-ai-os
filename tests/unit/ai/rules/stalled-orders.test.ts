import { describe, expect, it } from "vitest";

import { stalledOrdersRule } from "@/lib/ai/rules/stalled-orders";

import { emptyFacts } from "./fixtures";

const asOf = new Date("2026-07-20T12:00:00Z");

describe("stalledOrdersRule", () => {
  it("ignores unpaid orders younger than the threshold", () => {
    const facts = emptyFacts({
      open_orders: [
        {
          id: "o1",
          order_number: "O-1",
          status: "pending",
          payment_status: "unpaid",
          total: 50,
          created_at: "2026-07-20T10:00:00Z",
          updated_at: "2026-07-20T10:00:00Z",
          location_id: null,
        },
      ],
    });

    const result = stalledOrdersRule.evaluate({
      facts,
      config: { maxUnpaidAgeHours: 24 },
      organizationId: "org-1",
      locationId: null,
      asOf,
    });

    expect(result.signals).toHaveLength(0);
  });

  it("flags unpaid orders older than the threshold with finance-sensitive evidence, but never auto-marks paid", () => {
    const facts = emptyFacts({
      open_orders: [
        {
          id: "o1",
          order_number: "O-1",
          status: "completed",
          payment_status: "unpaid",
          total: 50,
          created_at: "2026-07-18T10:00:00Z",
          updated_at: "2026-07-18T10:00:00Z",
          location_id: null,
        },
      ],
    });

    const result = stalledOrdersRule.evaluate({
      facts,
      config: { maxUnpaidAgeHours: 24 },
      organizationId: "org-1",
      locationId: null,
      asOf,
    });

    expect(result.signals).toHaveLength(1);
    expect(result.recommendations).toHaveLength(1);
    expect(result.recommendations[0]!.recommendedActionType).toBe("navigate");
    expect(result.recommendations[0]!.evidence[0]!.isFinanceSensitive).toBe(true);
  });

  it("ignores orders that are already paid", () => {
    const facts = emptyFacts({
      open_orders: [
        {
          id: "o1",
          order_number: "O-1",
          status: "pending",
          payment_status: "paid",
          total: 50,
          created_at: "2026-07-18T10:00:00Z",
          updated_at: "2026-07-18T10:00:00Z",
          location_id: null,
        },
      ],
    });

    const result = stalledOrdersRule.evaluate({
      facts,
      config: { maxUnpaidAgeHours: 24 },
      organizationId: "org-1",
      locationId: null,
      asOf,
    });

    expect(result.signals).toHaveLength(0);
  });
});
