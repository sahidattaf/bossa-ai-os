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

  it("resolves the fictional Restaurant Command Center pilot tenant", () => {
    const tenant = getTenantBySlug("caribbean-ember");
    expect(tenant).toBeDefined();
    expect(tenant?.name).toBe("Caribbean Ember Grill — Demo Restaurant");
    expect(tenant?.id).toBe("org_demo_caribbean_ember");
    expect(tenant?.isDemo).toBe(true);
  });

  it("is case-insensitive on slug lookup", () => {
    expect(getTenantBySlug("BOSSA")?.slug).toBe("bossa");
  });

  it("lists the two existing tenants plus the isolated fictional pilot tenant", () => {
    expect(listTenantSlugs()).toEqual(["bossa", "papai", "caribbean-ember"]);
    expect(listTenants()).toHaveLength(3);
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