import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DashboardGrid } from "@/components/dashboard/dashboard-grid";
import { dashboardDataProvider } from "@/lib/dashboard/mock-provider";
import { getTenantBySlug } from "@/lib/tenancy/tenants";

describe("BOSSA dashboard rendering", () => {
  it("renders BOSSA's tenant-specific labels and KPI values", async () => {
    const tenant = getTenantBySlug("bossa")!;
    const data = await dashboardDataProvider.getDashboardData(tenant.id);
    render(<DashboardGrid tenant={tenant} data={data} />);

    expect(screen.getByText("Good evening, BOSSA team")).toBeInTheDocument();
    expect(screen.getByText("Fire Boxes Sold")).toBeInTheDocument();
    expect(screen.getByText("$45,000")).toBeInTheDocument();
    expect(screen.getByText("Food Cost %")).toBeInTheDocument();
    expect(screen.getAllByText(/BossVisionGPT/).length).toBeGreaterThan(0);
  });
});

describe("Papai dashboard rendering", () => {
  it("renders Papai's tenant-specific labels and KPI values", async () => {
    const tenant = getTenantBySlug("papai")!;
    const data = await dashboardDataProvider.getDashboardData(tenant.id);
    render(<DashboardGrid tenant={tenant} data={data} />);

    expect(screen.getByText("Good evening, Papai team")).toBeInTheDocument();
    expect(screen.getByText("Heritage Platters Served")).toBeInTheDocument();
    expect(screen.getByText("ANG 8,200")).toBeInTheDocument();
    expect(screen.getAllByText(/PapaiLegacyGPT/).length).toBeGreaterThan(0);
  });
});

describe("cross-tenant label isolation", () => {
  it("shows no BOSSA labels inside the Papai dashboard", async () => {
    const tenant = getTenantBySlug("papai")!;
    const data = await dashboardDataProvider.getDashboardData(tenant.id);
    render(<DashboardGrid tenant={tenant} data={data} />);

    expect(screen.queryByText(/Fire Boxes/)).not.toBeInTheDocument();
    expect(screen.queryByText(/BossVisionGPT/)).not.toBeInTheDocument();
    expect(screen.queryByText(/BOSSA/)).not.toBeInTheDocument();
  });

  it("shows no Papai labels inside the BOSSA dashboard", async () => {
    const tenant = getTenantBySlug("bossa")!;
    const data = await dashboardDataProvider.getDashboardData(tenant.id);
    render(<DashboardGrid tenant={tenant} data={data} />);

    expect(screen.queryByText(/Heritage Platters/)).not.toBeInTheDocument();
    expect(screen.queryByText(/PapaiLegacyGPT/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Papai/)).not.toBeInTheDocument();
  });
});
