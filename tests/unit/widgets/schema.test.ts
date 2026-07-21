import { describe, expect, it } from "vitest";

import { getTenantBySlug } from "@/lib/tenancy/tenants";
import { validateDashboardWidgets } from "@/lib/widgets/schema";

describe("widget registry validation", () => {
  it("accepts BOSSA's and Papai's real widget configuration", () => {
    expect(() => validateDashboardWidgets(getTenantBySlug("bossa")!.dashboardWidgets)).not.toThrow();
    expect(() => validateDashboardWidgets(getTenantBySlug("papai")!.dashboardWidgets)).not.toThrow();
  });

  it("rejects an unknown widget key", () => {
    expect(() =>
      validateDashboardWidgets([{ key: "notARealWidget", order: 1, size: "sm", visible: true }]),
    ).toThrow();
  });

  it("rejects an invalid size", () => {
    expect(() =>
      validateDashboardWidgets([{ key: "greeting", order: 1, size: "huge", visible: true }]),
    ).toThrow();
  });

  it("rejects a negative order", () => {
    expect(() =>
      validateDashboardWidgets([{ key: "greeting", order: -1, size: "sm", visible: true }]),
    ).toThrow();
  });

  it("rejects a missing visible flag", () => {
    expect(() => validateDashboardWidgets([{ key: "greeting", order: 1, size: "sm" }])).toThrow();
  });
});
