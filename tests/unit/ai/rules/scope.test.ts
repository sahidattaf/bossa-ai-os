import { describe, expect, it } from "vitest";

import { ruleAppliesToScope } from "@/lib/ai/rules/types";
import { RULE_REGISTRY } from "@/lib/ai/rules/rule-registry";

describe("ruleAppliesToScope", () => {
  it("'organization' rules only apply to the organization-wide run (locationId null)", () => {
    expect(ruleAppliesToScope("organization", null)).toBe(true);
    expect(ruleAppliesToScope("organization", "loc-a")).toBe(false);
  });

  it("'location' rules only apply to a location-scoped run (locationId set)", () => {
    expect(ruleAppliesToScope("location", "loc-a")).toBe(true);
    expect(ruleAppliesToScope("location", null)).toBe(false);
  });

  it("'both' rules apply to every run regardless of locationId", () => {
    expect(ruleAppliesToScope("both", null)).toBe(true);
    expect(ruleAppliesToScope("both", "loc-a")).toBe(true);
  });

  it("every rule in the registry declares an explicit scope", () => {
    for (const rule of RULE_REGISTRY) {
      expect(["organization", "location", "both"]).toContain(rule.scope);
    }
  });
});
