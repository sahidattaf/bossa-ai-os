import { describe, expect, it } from "vitest";

import { kpiStalenessRule } from "@/lib/ai/rules/kpi-staleness";

import { emptyFacts } from "./fixtures";

const asOf = new Date("2026-07-20T12:00:00Z");

describe("kpiStalenessRule", () => {
  it("stays quiet when the latest snapshot is within the allowed window", () => {
    const facts = emptyFacts({
      latest_kpi_snapshot: {
        id: "snap-1",
        snapshot_date: "2026-07-19",
        revenue: 100,
        average_ticket: 20,
        order_count: 5,
        reservation_count: 2,
        location_id: null,
      },
    });

    const result = kpiStalenessRule.evaluate({ facts, config: { maxStaleDays: 2 }, organizationId: "org-1", locationId: null, asOf });
    expect(result.signals).toHaveLength(0);
  });

  it("fires with a regenerate_kpi_snapshot recommendation once the snapshot is older than the threshold", () => {
    const facts = emptyFacts({
      latest_kpi_snapshot: {
        id: "snap-1",
        snapshot_date: "2026-07-16",
        revenue: 100,
        average_ticket: 20,
        order_count: 5,
        reservation_count: 2,
        location_id: null,
      },
    });

    const result = kpiStalenessRule.evaluate({ facts, config: { maxStaleDays: 2 }, organizationId: "org-1", locationId: null, asOf });
    expect(result.signals).toHaveLength(1);
    expect(result.recommendations[0]!.recommendedActionType).toBe("regenerate_kpi_snapshot");
    expect(result.recommendations[0]!.requiresApproval).toBe(true);
  });

  it("fires when there has never been a snapshot at all", () => {
    const result = kpiStalenessRule.evaluate({
      facts: emptyFacts(),
      config: { maxStaleDays: 2 },
      organizationId: "org-1",
      locationId: null,
      asOf,
    });
    expect(result.signals).toHaveLength(1);
  });
});
