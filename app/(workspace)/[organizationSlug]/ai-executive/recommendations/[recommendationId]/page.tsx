import Link from "next/link";
import { notFound } from "next/navigation";

import { ApprovalActions } from "@/components/ai/approval-actions";
import { DismissButton } from "@/components/ai/dismiss-button";
import { EvidencePanel } from "@/components/ai/evidence-panel";
import { SeverityBadge } from "@/components/ai/severity-badge";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { PermissionState } from "@/components/ui/permission-state";
import { getRecommendationDetail } from "@/lib/ai/recommendations";
import { toOperationalError } from "@/lib/errors";
import { resolveWorkspacePageContext } from "@/lib/tenancy/page-context";
import { hasPermission } from "@/lib/widgets/permissions";

import { approveAndExecuteAction, dismissRecommendationAction, rejectRecommendationAction } from "../../actions";

export default async function AiRecommendationDetailPage({
  params,
}: {
  params: Promise<{ organizationSlug: string; recommendationId: string }>;
}) {
  const { organizationSlug, recommendationId } = await params;
  const context = await resolveWorkspacePageContext(organizationSlug);

  // Mock mode has no real recommendation records to look up — the priority
  // feed never links here in that mode either (issue #18 decision #11).
  if (context.mode === "mock") {
    notFound();
  }

  if (!hasPermission(context.permissions, "ai.executive.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Recommendation" description="Evidence and decision history" />
        <PermissionState requiredPermission="ai.executive.read" />
      </div>
    );
  }

  const canApprove = hasPermission(context.permissions, "ai.actions.approve");
  const canManage = hasPermission(context.permissions, "ai.recommendations.manage");

  let detail: Awaited<ReturnType<typeof getRecommendationDetail>> = null;
  let loadError: string | null = null;

  try {
    detail = await getRecommendationDetail(context.supabase, context.tenant.id, recommendationId);
  } catch (error) {
    loadError = toOperationalError(error as never).message;
  }

  if (loadError) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Recommendation" description="Evidence and decision history" />
        <p role="alert" className="text-sm text-danger">
          {loadError}
        </p>
      </div>
    );
  }

  if (!detail) {
    notFound();
  }

  const { recommendation, evidence, approval, outcome } = detail;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={recommendation.title}
        description={`${context.tenant.name} — ${recommendation.recommendation_type.replace(/_/g, " ")}`}
        actions={
          <Link href={`/${organizationSlug}/ai-executive`} className="text-sm text-muted-foreground hover:underline">
            ← Back to AI Executive
          </Link>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="flex flex-col gap-1 pt-5">
            <span className="text-xs text-muted-foreground">Severity</span>
            <SeverityBadge severity={recommendation.severity} />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-1 pt-5">
            <span className="text-xs text-muted-foreground">Status</span>
            <span className="text-sm font-medium text-foreground">{recommendation.status.replace(/_/g, " ")}</span>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-1 pt-5">
            <span className="text-xs text-muted-foreground">Priority score</span>
            <span className="text-sm font-medium text-foreground">{recommendation.priority_score}</span>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-1 pt-5">
            <span className="text-xs text-muted-foreground">Risk level</span>
            <span className="text-sm font-medium text-foreground">{recommendation.risk_level}</span>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-2 pt-5">
          <p className="text-sm text-foreground">{recommendation.executive_summary}</p>
          <p className="text-xs text-muted-foreground">
            Rule: {recommendation.rule_id} ({recommendation.rule_version}) · Action: {recommendation.recommended_action_type}
          </p>
        </CardContent>
      </Card>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">Evidence</h2>
        <EvidencePanel
          evidence={evidence.map((item) => ({
            id: item.id,
            metricName: item.metric_name,
            observedValue: item.observed_value,
            expectedValue: item.expected_value,
            calculationDefinition: item.calculation_definition,
            sourceEntityType: item.source_entity_type,
            sourceEntityId: item.source_entity_id,
          }))}
        />
      </section>

      {approval && approval.status === "pending" ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">Decision</h2>
          {canApprove ? (
            <ApprovalActions
              approveAction={approveAndExecuteAction}
              rejectAction={rejectRecommendationAction}
              organizationSlug={organizationSlug}
              approvalId={approval.id}
              version={approval.version}
            />
          ) : (
            <PermissionState requiredPermission="ai.actions.approve" description="Deciding this recommendation requires ai.actions.approve." />
          )}
        </section>
      ) : approval ? (
        <p className="text-sm text-muted-foreground">
          Decision: {approval.status.replace(/_/g, " ")}
          {approval.reason ? ` — ${approval.reason}` : ""}
        </p>
      ) : null}

      {canManage && recommendation.status === "proposed" ? (
        <DismissButton
          dismissAction={dismissRecommendationAction}
          organizationSlug={organizationSlug}
          recommendationId={recommendation.id}
        />
      ) : null}

      {outcome ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">Outcome</h2>
          <Card>
            <CardContent className="flex flex-col gap-1 pt-5">
              <span className="text-sm font-medium text-foreground">{outcome.status.replace(/_/g, " ")}</span>
              {outcome.human_notes ? <p className="text-xs text-muted-foreground">{outcome.human_notes}</p> : null}
              {outcome.failure_message ? <p className="text-xs text-danger">{outcome.failure_message}</p> : null}
            </CardContent>
          </Card>
        </section>
      ) : null}
    </div>
  );
}
