import { describe, expect, it } from "vitest";

import { hasPermission } from "@/lib/widgets/permissions";

describe("permission checks", () => {
  it("allows anything when no permission is required", () => {
    expect(hasPermission([], undefined)).toBe(true);
  });

  it("allows a granted permission that matches exactly", () => {
    expect(hasPermission(["finance.read"], "finance.read")).toBe(true);
  });

  it("denies a permission that isn't granted", () => {
    expect(hasPermission(["orders.read"], "finance.read")).toBe(false);
  });

  it("treats the wildcard as granting everything", () => {
    expect(hasPermission(["*"], "ai.actions.approve")).toBe(true);
  });
});
