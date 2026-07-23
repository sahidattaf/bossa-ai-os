import { describe, expect, it } from "vitest";

import {
  describeBootstrapPlan,
  parseArgs,
  resolveBootstrapTargets,
  TENANT_BOOTSTRAP_SPECS,
} from "@/scripts/lib/bootstrap-production-tenants-plan";

describe("bootstrap-production-tenants plan (pure logic only — no Supabase I/O)", () => {
  it("parseArgs defaults to no org filter, no owner emails, and confirm=false", () => {
    expect(parseArgs([])).toEqual({ ownerEmails: {}, confirm: false });
  });

  it("parseArgs reads --org, --*-owner-email, and --confirm", () => {
    const args = parseArgs([
      "--org=bossa",
      "--bossa-owner-email=owner@bossa.example",
      "--papai-owner-email=owner@papai.example",
      "--confirm",
    ]);
    expect(args).toEqual({
      org: "bossa",
      ownerEmails: { bossa: "owner@bossa.example", papai: "owner@papai.example" },
      confirm: true,
    });
  });

  it("parseArgs ignores an invalid --org value rather than accepting it", () => {
    const args = parseArgs(["--org=not-a-real-tenant"]);
    expect(args.org).toBeUndefined();
  });

  it("resolveBootstrapTargets defaults to both tenants when no org is given", () => {
    expect(resolveBootstrapTargets(undefined)).toEqual(["bossa", "papai"]);
  });

  it("resolveBootstrapTargets narrows to exactly one tenant when given", () => {
    expect(resolveBootstrapTargets("papai")).toEqual(["papai"]);
  });

  it("describeBootstrapPlan mentions the owner invite only when an email is given", () => {
    const withEmail = describeBootstrapPlan(["bossa"], { bossa: "owner@bossa.example" });
    expect(withEmail.some((line) => line.includes("invite owner \"owner@bossa.example\""))).toBe(true);

    const withoutEmail = describeBootstrapPlan(["bossa"], {});
    expect(withoutEmail.some((line) => line.includes("no owner email given"))).toBe(true);
    expect(withoutEmail.some((line) => line.includes("invite owner"))).toBe(false);
  });

  it("describeBootstrapPlan covers every requested target and nothing else", () => {
    const lines = describeBootstrapPlan(["bossa", "papai"], {});
    expect(lines.some((line) => line.startsWith("bossa:"))).toBe(true);
    expect(lines.some((line) => line.startsWith("papai:"))).toBe(true);
  });

  it("Papai's spec preserves its real 'onboarding' business status, not 'active'", () => {
    expect(TENANT_BOOTSTRAP_SPECS.papai.status).toBe("onboarding");
    expect(TENANT_BOOTSTRAP_SPECS.bossa.status).toBe("active");
  });

  it("every tenant spec uses its own dashboard-widgets array instance, not a shared reference", () => {
    expect(TENANT_BOOTSTRAP_SPECS.bossa.settings.dashboardWidgets).not.toBe(
      TENANT_BOOTSTRAP_SPECS.papai.settings.dashboardWidgets,
    );
  });
});
