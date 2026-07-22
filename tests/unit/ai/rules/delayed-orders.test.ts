import { describe, expect, it } from "vitest";

import { delayedOrdersRule } from "@/lib/ai/rules/delayed-orders";

import { emptyFacts } from "./fixtures";

const asOf = new Date("2026-07-20T12:00:00Z");

describe("delayedOrdersRule", () => {
  it("ignores a preparing order within its allowed window", () => {
    const facts = emptyFacts({
      open_orders: [
        {
          id: "o1",
          order_number: "O-1",
          status: "preparing",
          payment_status: "paid",
          total: 20,
          created_at: "2026-07-20T11:50:00Z",
          updated_at: "2026-07-20T11:50:00Z",
          location_id: null,
        },
      ],
    });

    const result = delayedOrdersRule.evaluate({
      facts,
      config: { maxPreparingMinutes: 30, maxReadyMinutes: 15 },
      organizationId: "org-1",
      locationId: null,
      asOf,
    });

    expect(result.signals).toHaveLength(0);
  });

  it("flags a preparing order past its window", () => {
    const facts = emptyFacts({
      open_orders: [
        {
          id: "o1",
          order_number: "O-1",
          status: "preparing",
          payment_status: "paid",
          total: 20,
          created_at: "2026-07-20T11:00:00Z",
          updated_at: "2026-07-20T11:00:00Z",
          location_id: null,
        },
      ],
    });

    const result = delayedOrdersRule.evaluate({
      facts,
      config: { maxPreparingMinutes: 30, maxReadyMinutes: 15 },
      organizationId: "org-1",
      locationId: null,
      asOf,
    });

    expect(result.signals).toHaveLength(1);
    expect(result.signals[0]!.dedupeKey).toBe("delayed_order:o1");
  });

  it("uses the ready-specific window for ready orders", () => {
    const facts = emptyFacts({
      open_orders: [
        {
          id: "o1",
          order_number: "O-1",
          status: "ready",
          payment_status: "paid",
          total: 20,
          created_at: "2026-07-20T11:00:00Z",
          updated_at: "2026-07-20T11:40:00Z",
          location_id: null,
        },
      ],
    });

    const result = delayedOrdersRule.evaluate({
      facts,
      config: { maxPreparingMinutes: 30, maxReadyMinutes: 15 },
      organizationId: "org-1",
      locationId: null,
      asOf,
    });

    expect(result.signals).toHaveLength(1);
  });
});
