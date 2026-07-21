import { describe, expect, it } from "vitest";

import { getTenantBySlug, listTenantSlugs, listTenants } from "@/lib/tenancy/tenants";

describe("tenant configuration resolution", () => {
  it("resolves BOSSA by its slug", () => {
    const tenant = getTenantBySlug("bossa");
    expect(tenant).toBeDefined();
    expect(tenant?.name).toBe("BOSSA Asado i Mar");
    expect(tenant?.id).toBe("org_001_bossa");
  });

  it("resolves Papai by its slug", () => {
    const tenant = getTenantBySlug("papai");
    expect(tenant).toBeDefined();
    expect(tenant?.name).toBe("Papai Since 1933");
    expect(tenant?.id).toBe("org_002_papai");
  });

  it("is case-insensitive on slug lookup", () => {
    expect(getTenantBySlug("BOSSA")?.slug).toBe("bossa");
  });

  it("lists exactly the two seeded tenant slugs", () => {
    expect(listTenantSlugs()).toEqual(["bossa", "papai"]);
    expect(listTenants()).toHaveLength(2);
  });
});

describe("invalid tenant handling", () => {
  it("returns undefined for an unknown slug", () => {
    expect(getTenantBySlug("nonexistent")).toBeUndefined();
  });

  it("returns undefined for an empty slug", () => {
    expect(getTenantBySlug("")).toBeUndefined();
  });
});
