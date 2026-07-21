import type { DashboardDataProvider } from "./data-provider";
import { BOSSA_DASHBOARD_DATA } from "./mock-data/bossa";
import { PAPAI_DASHBOARD_DATA } from "./mock-data/papai";
import type { DashboardData } from "./types";

const DATA_BY_ORGANIZATION_ID: Record<string, DashboardData> = {
  org_001_bossa: BOSSA_DASHBOARD_DATA,
  org_002_papai: PAPAI_DASHBOARD_DATA,
};

export class MockDashboardDataProvider implements DashboardDataProvider {
  async getDashboardData(organizationId: string): Promise<DashboardData> {
    const data = DATA_BY_ORGANIZATION_ID[organizationId];

    if (!data) {
      throw new Error(`No mock dashboard data configured for organization "${organizationId}"`);
    }

    return data;
  }
}

export const dashboardDataProvider: DashboardDataProvider = new MockDashboardDataProvider();
