import Link from "next/link";
import { ClipboardCheck } from "lucide-react";

import { ApprovalActions } from "@/components/ai/approval-actions";
import { SeverityBadge } from "@/components/ai/severity-badge";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { PermissionState } from "@/components/ui/permission-state";
import { getMockApprovals } from "@/lib/ai/mock-fixtures";
import { listPendingApprovals } from "@/lib/ai/recommendations";
import { toOperationalError } from "@/lib/errors";
import { resolveWorkspacePageContext } from "@/lib/tenancy/page-context";
import { hasPermission } from "@/lib/widgets/permissions";

import { approveAndExecuteAction, rejectRecommendationAction } from "../actions";

export default async function AiExecutiveApprovalsPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  const context = await resolveWorkspacePageContext(organizationSlug);

  if (!hasPermission(context.permissions, "ai.executive.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Approval queue" description="Recommendations awaiting a decision" />
        <PermissionState requiredPermission="ai.executive.read" />
      </div>
    );
  }

  const canApprove = hasPermission(context.permissions, "ai.actions.approve");

  interface ApprovalRow {
    approvalId: string;
    version: number;
    recommendationId: string;
    recommendationTitle: string;
    recommendationType: string;
    severity: string;
  }

  let approvals: ApprovalRow[] = [];
  let loadError: string | null = null;

  if (context.mode === "mock") {
    approvals = getMockApprovals(context.tenant.id).map((a) => ({
      approvalId: a.id,
      version: 1,
      recommendationId: a.id,
      recommendationTitle: a.recommendationTitle,
      recommendationType: a.recommendationType,
      severity: "warning",
    }));
  } else {
    try {
      const pending = await listPendingApprovals(context.supabase, context.tenant.id);
      approvals = pending.map(({ approval, recommendation }) => ({
        approvalId: approval.id,
        version: approval.version,
        recommendationId: recommendation.id,
        recommendationTitle: recommendation.title,
        recommendationType: recommendation.recommendation_type,
        severity: recommendation.severity,
      }));
    } catch (error) {
      loadError = toOperationalError(error as never).message;
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Approval queue" description={`${context.tenant.name} — recommendations awaiting a decision`} />

      {context.mode === "mock" ? (
        <p className="rounded-md border border-dashed border-border bg-surface-elevated/50 px-4 py-2 text-xs text-muted-foreground">
          Demo mode — read-only. Approving or rejecting requires a live organization.
        </p>
      ) : !canApprove ? (
        <PermissionState
          requiredPermission="ai.actions.approve"
          description="You can view the approval queue, but deciding an approval requires the ai.actions.approve permission."
        />
      ) : null}

      {loadError ? (
        <ErrorState description={loadError} />
      ) : approvals.length === 0 ? (
        <EmptyState icon={ClipboardCheck} title="Nothing waiting on approval" description="You're all caught up." />
      ) : (
        <ul className="flex flex-col gap-3">
          {approvals.map((approval) => (
            <li key={approval.approvalId} className="flex flex-col gap-3 rounded-lg border border-border p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <SeverityBadge severity={approval.severity} />
                  {context.mode === "supabase" ? (
                    <Link
                      href={`/${organizationSlug}/ai-executive/recommendations/${approval.recommendationId}`}
                      className="text-sm font-medium text-foreground hover:underline"
                    >
                      {approval.recommendationTitle}
                    </Link>
                  ) : (
                    <span className="text-sm font-medium text-foreground">{approval.recommendationTitle}</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{approval.recommendationType.replace(/_/g, " ")}</p>
              </div>
              {context.mode === "supabase" && canApprove ? (
                <ApprovalActions
                  approveAction={approveAndExecuteAction}
                  rejectAction={rejectRecommendationAction}
                  organizationSlug={organizationSlug}
                  approvalId={approval.approvalId}
                  version={approval.version}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
