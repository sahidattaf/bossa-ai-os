/**
 * Static, read-only demo fixtures for the AI Executive workspace in mock
 * mode (issue #18 decision #11 — "explicitly labeled, fictional,
 * tenant-isolated, and read-only... must not fake persistence or
 * execution"). Same convention as lib/operations/mock-fixtures.ts: display
 * shapes only, not the full database Row types, since mock mode has no
 * database behind it.
 */

export interface MockSignalRow {
  id: string;
  severity: "info" | "warning" | "critical";
  title: string;
}

export interface MockRecommendationRow {
  id: string;
  title: string;
  executiveSummary: string;
  severity: "info" | "warning" | "critical";
  status: string;
  recommendationType: string;
}

export interface MockApprovalRow {
  id: string;
  recommendationTitle: string;
  recommendationType: string;
}

const BOSSA_SIGNALS: MockSignalRow[] = [
  { id: "mock-signal-bossa-1", severity: "warning", title: "1 unanswered lead" },
];

const PAPAI_SIGNALS: MockSignalRow[] = [{ id: "mock-signal-papai-1", severity: "info", title: "1 unanswered lead" }];

const BOSSA_RECOMMENDATIONS: MockRecommendationRow[] = [
  {
    id: "mock-rec-bossa-1",
    title: "Follow up with Demo Guest — Maria F.",
    executiveSummary: "Demo Guest — Maria F. has no assigned owner and is still unanswered.",
    severity: "warning",
    status: "proposed",
    recommendationType: "unanswered_lead_followup",
  },
  {
    id: "mock-rec-bossa-2",
    title: "Revenue is trailing target today",
    executiveSummary: "Today's revenue is below the configured daily target.",
    severity: "info",
    status: "proposed",
    recommendationType: "revenue_below_target",
  },
];

const PAPAI_RECOMMENDATIONS: MockRecommendationRow[] = [
  {
    id: "mock-rec-papai-1",
    title: "Follow up with Demo Guest — Ronnie S.",
    executiveSummary: "Demo Guest — Ronnie S. has no assigned owner and is still unanswered.",
    severity: "info",
    status: "proposed",
    recommendationType: "unanswered_lead_followup",
  },
];

const BOSSA_APPROVALS: MockApprovalRow[] = [
  { id: "mock-approval-bossa-1", recommendationTitle: "Follow up with Demo Guest — Maria F.", recommendationType: "unanswered_lead_followup" },
];

const PAPAI_APPROVALS: MockApprovalRow[] = [
  { id: "mock-approval-papai-1", recommendationTitle: "Follow up with Demo Guest — Ronnie S.", recommendationType: "unanswered_lead_followup" },
];

const SIGNALS_BY_TENANT_ID: Record<string, MockSignalRow[]> = {
  org_001_bossa: BOSSA_SIGNALS,
  org_002_papai: PAPAI_SIGNALS,
};

const RECOMMENDATIONS_BY_TENANT_ID: Record<string, MockRecommendationRow[]> = {
  org_001_bossa: BOSSA_RECOMMENDATIONS,
  org_002_papai: PAPAI_RECOMMENDATIONS,
};

const APPROVALS_BY_TENANT_ID: Record<string, MockApprovalRow[]> = {
  org_001_bossa: BOSSA_APPROVALS,
  org_002_papai: PAPAI_APPROVALS,
};

export function getMockSignals(tenantId: string): MockSignalRow[] {
  return SIGNALS_BY_TENANT_ID[tenantId] ?? [];
}

export function getMockRecommendations(tenantId: string): MockRecommendationRow[] {
  return RECOMMENDATIONS_BY_TENANT_ID[tenantId] ?? [];
}

export function getMockApprovals(tenantId: string): MockApprovalRow[] {
  return APPROVALS_BY_TENANT_ID[tenantId] ?? [];
}
