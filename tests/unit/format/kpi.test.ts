import { describe, expect, it } from "vitest";

import { formatCurrency, formatNumber, formatPercentage, formatTrend } from "@/lib/format/kpi";

describe("KPI value formatting", () => {
  it("formats currency with no decimal places", () => {
    expect(formatCurrency(45000, "USD", "en-US")).toBe("$45,000");
  });

  it("formats a different currency with the right symbol", () => {
    expect(formatCurrency(8200, "ANG", "en-US")).toContain("8,200");
  });

  it("formats large numbers with locale grouping", () => {
    expect(formatNumber(120000, "en-US")).toBe("120,000");
  });

  it("formats percentages with one decimal by default", () => {
    expect(formatPercentage(31.4)).toBe("31.4%");
  });

  it("formats percentages with a custom precision", () => {
    expect(formatPercentage(31.428, 2)).toBe("31.43%");
  });
});

describe("trend formatting", () => {
  it("formats a positive trend with a plus sign and success tone by default", () => {
    const result = formatTrend({ deltaPercent: 4.2, comparisonLabel: "vs last week" });
    expect(result.direction).toBe("up");
    expect(result.label).toBe("+4.2% vs last week");
    expect(result.toneClassName).toBe("text-success");
  });

  it("formats a negative trend with a minus sign and danger tone by default", () => {
    const result = formatTrend({ deltaPercent: -3.1, comparisonLabel: "vs last week" });
    expect(result.direction).toBe("down");
    expect(result.label).toBe("-3.1% vs last week");
    expect(result.toneClassName).toBe("text-danger");
  });

  it("formats a zero delta as flat with no sign", () => {
    const result = formatTrend({ deltaPercent: 0, comparisonLabel: "vs last week" });
    expect(result.direction).toBe("flat");
    expect(result.label).toBe("No change vs last week");
    expect(result.toneClassName).toBe("text-muted-foreground");
  });

  it("flips tone for increase-is-bad metrics without changing the sign or direction", () => {
    const result = formatTrend({ deltaPercent: 2.1, comparisonLabel: "vs last week" }, "increase-is-bad");
    expect(result.direction).toBe("up");
    expect(result.label).toBe("+2.1% vs last week");
    expect(result.toneClassName).toBe("text-danger");
  });

  it("treats a decrease as favorable for increase-is-bad metrics", () => {
    const result = formatTrend({ deltaPercent: -1.4, comparisonLabel: "vs last week" }, "increase-is-bad");
    expect(result.direction).toBe("down");
    expect(result.toneClassName).toBe("text-success");
  });
});
