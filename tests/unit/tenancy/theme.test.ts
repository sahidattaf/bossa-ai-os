import { describe, expect, it } from "vitest";

import { getTenantBySlug } from "@/lib/tenancy/tenants";
import { getTenantThemeVars, resolveThemeMode } from "@/lib/tenancy/theme";

describe("theme-token generation", () => {
  it("resolves light/dark modes as-is and system to dark", () => {
    expect(resolveThemeMode("dark")).toBe("dark");
    expect(resolveThemeMode("light")).toBe("light");
    expect(resolveThemeMode("system")).toBe("dark");
  });

  it("generates BOSSA's ember-orange primary token from its own branding", () => {
    const bossa = getTenantBySlug("bossa")!;
    const vars = getTenantThemeVars(bossa);
    expect(vars["--primary"]).toBe(bossa.branding.primaryColor);
    expect(vars["--radius"]).toBe("0.75rem");
  });

  it("generates Papai's independent primary token, distinct from BOSSA's", () => {
    const papai = getTenantBySlug("papai")!;
    const bossa = getTenantBySlug("bossa")!;
    const papaiVars = getTenantThemeVars(papai);
    expect(papaiVars["--primary"]).toBe(papai.branding.primaryColor);
    expect(papaiVars["--primary"]).not.toBe(bossa.branding.primaryColor);
    expect(papaiVars["--radius"]).toBe("1rem");
  });
});
