import { describe, expect, it } from "vitest";

import { getMockApprovals, getMockRecommendations, getMockSignals } from "@/lib/ai/mock-fixtures";
import { dashboardDataProvider } from "@/lib/dashboard/mock-provider";
import { getMockLeads, getMockOrders, getMockReservations } from "@/lib/operations/mock-fixtures";
import { getTenantBySlug } from "@/lib/tenancy/tenants";

const DEMO_TENANT_ID = "org_demo_caribbean_ember";

describe("Restaurant Command Center fictional pilot isolation", () => {
  it("is explicitly marked as a demo tenant", () => {
    const tenant = getTenantBySlug("caribbean-ember");
    expect(tenant?.isDemo).toBe(true);
    expect(tenant?.name).toContain("Demo Restaurant");
    expect(tenant?.currency).toBe("XCG");
  });

  it("uses deterministic fictional operational fixtures", () => {
    const leads = getMockLeads(DEMO_TENANT_ID);
    const reservations = getMockReservations(DEMO_TENANT_ID);
    const orders = getMockOrders(DEMO_TENANT_ID);

    expect(leads).toHaveLength(12);
    expect(reservations).toHaveLength(35);
    expect(orders).toHaveLength(18);
    expect(leads.every((row) => row.contactName.startsWith("Demo Guest"))).toBe(true);
    expect(reservations.every((row) => row.guestName.startsWith("Demo Guest"))).toBe(true);
    expect(orders.every((row) => row.customerName.startsWith("Demo Guest"))).toBe(true);
  });

  it("contains no BOSSA or Papai identity in the fictional pilot fixtures", () => {
    const serialized = JSON.stringify({
      leads: getMockLeads(DEMO_TENANT_ID),
      reservations: getMockReservations(DEMO_TENANT_ID),
      orders: getMockOrders(DEMO_TENANT_ID),
      signals: getMockSignals(DEMO_TENANT_ID),
      recommendations: getMockRecommendations(DEMO_TENANT_ID),
      approvals: getMockApprovals(DEMO_TENANT_ID),
    });

    expect(serialized).not.toContain("BOSSA");
    expect(serialized).not.toContain("Papai");
    expect(serialized).not.toContain("Asado");
  });

  it("uses only mocked non-live AI workflow records", () => {
    expect(getMockSignals(DEMO_TENANT_ID)).toHaveLength(2);
    expect(getMockRecommendations(DEMO_TENANT_ID)).toHaveLength(2);
    expect(getMockApprovals(DEMO_TENANT_ID)).toHaveLength(1);
    expect(JSON.stringify(getMockRecommendations(DEMO_TENANT_ID))).toContain("No WhatsApp");
  });

  it("labels dashboard content as demo and non-live", async () => {
    const data = await dashboardDataProvider.getDashboardData(DEMO_TENANT_ID);
    expect(data.greeting.summary).toContain("DEMO DATA — NOT LIVE");
    expect(data.liveAlerts.some((alert) => alert.message === "DEMO DATA — NOT LIVE")).toBe(true);
    expect(data.whatsappLeads.trend.comparisonLabel).toBe("mock messaging only");
  });
});
