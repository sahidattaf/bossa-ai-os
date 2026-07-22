import Link from "next/link";
import { Sparkles } from "lucide-react";

import { RecommendationCard } from "@/components/ai/recommendation-card";
import { SeverityBadge } from "@/components/ai/severity-badge";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { PermissionState } from "@/components/ui/permission-state";
import { toOperationalError } from "@/lib/errors";
import { getMockRecommendations, getMockSignals } from "@/lib/ai/mock-fixtures";
import { listActiveSignals, listRecommendations } from "@/lib/ai/recommendations";
import { resolveWorkspacePageContext } from "@/lib/tenancy/page-context";
import { hasPermission } from "@/lib/widgets/permissions";

export default async function AiExecutivePage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  const context = await resolveWorkspacePageContext(organizationSlug);

  if (!hasPermission(context.permissions, "ai.executive.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="AI Executive" description="Signals, recommendations, and evidence" />
        <PermissionState requiredPermission="ai.executive.read" />
      </div>
    );
  }

  interface SignalRow {
    id: string;
    severity: string;
    title: string;
  }
  interface RecommendationRow {
    id: string;
    title: string;
    executiveSummary: string;
    severity: string;
    status: string;
    recommendationType: string;
  }

  let signals: SignalRow[] = [];
  let recommendations: RecommendationRow[] = [];
  let loadError: string | null = null;

  if (context.mode === "mock") {
    signals = getMockSignals(context.tenant.id);
    recommendations = getMockRecommendations(context.tenant.id).map((r) => ({
      id: r.id,
      title: r.title,
      executiveSummary: r.executiveSummary,
      severity: r.severity,
      status: r.status,
      recommendationType: r.recommendationType,
    }));
  } else {
    try {
      const [signalRows, recommendationRows] = await Promise.all([
        listActiveSignals(context.supabase, context.tenant.id),
        listRecommendations(context.supabase, context.tenant.id),
      ]);
      signals = signalRows.map((s) => ({ id: s.id, severity: s.severity, title: s.title }));
      recommendations = recommendationRows
        .filter((r) => ["proposed", "approved", "executing"].includes(r.status))
        .map((r) => ({
          id: r.id,
          title: r.title,
          executiveSummary: r.executive_summary,
          severity: r.severity,
          status: r.status,
          recommendationType: r.recommendation_type,
        }));
    } catch (error) {
      loadError = toOperationalError(error as never).message;
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="AI Executive"
        description={`${context.tenant.name} — signals, recommendations, and evidence`}
        actions={
          context.mode === "supabase" ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`/${organizationSlug}/ai-executive/approvals`}>Approval queue</Link>
            </Button>
          ) : undefined
        }
      />

      <p className="flex items-center gap-2 rounded-md border border-dashed border-border bg-surface-elevated/50 px-4 py-2 text-xs text-muted-foreground">
        <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
        Deterministic mode — every recommendation below comes from rule-based evidence, not an external AI model.
      </p>

      {context.mode === "mock" ? (
        <p className="rounded-md border border-dashed border-border bg-surface-elevated/50 px-4 py-2 text-xs text-muted-foreground">
          Demo mode — read-only. Fictional signals and recommendations shown below; approving or executing requires a
          live organization.
        </p>
      ) : null}

      {loadError ? (
        <ErrorState description={loadError} />
      ) : (
        <>
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-medium text-muted-foreground">Active signals</h2>
            {signals.length === 0 ? (
              <EmptyState title="No active signals" description="Nothing needs attention right now." />
            ) : (
              <ul className="flex flex-col gap-2">
                {signals.map((signal) => (
                  <li key={signal.id} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
                    <SeverityBadge severity={signal.severity} />
                    <span className="text-foreground">{signal.title}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-medium text-muted-foreground">Priority recommendations</h2>
            {recommendations.length === 0 ? (
              <EmptyState
                icon={Sparkles}
                title="Nothing to recommend yet"
                description="Recommendations from the deterministic rules engine will show up here."
              />
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {recommendations.map((recommendation) => (
                  <RecommendationCard
                    key={recommendation.id}
                    href={
                      context.mode === "supabase"
                        ? `/${organizationSlug}/ai-executive/recommendations/${recommendation.id}`
                        : undefined
                    }
                    title={recommendation.title}
                    executiveSummary={recommendation.executiveSummary}
                    severity={recommendation.severity}
                    status={recommendation.status}
                    recommendationType={recommendation.recommendationType}
                  />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
