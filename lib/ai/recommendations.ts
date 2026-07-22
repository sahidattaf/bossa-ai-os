import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { toOperationalError } from "@/lib/errors";
import type { Database } from "@/lib/supabase/database.types";

type SupabaseDb = SupabaseClient<Database>;
type Recommendation = Database["public"]["Tables"]["ai_recommendations"]["Row"];
type Approval = Database["public"]["Tables"]["ai_approvals"]["Row"];
type Evidence = Database["public"]["Tables"]["ai_recommendation_evidence"]["Row"];
type Signal = Database["public"]["Tables"]["ai_signals"]["Row"];
type Outcome = Database["public"]["Tables"]["ai_outcomes"]["Row"];

export async function listActiveSignals(supabase: SupabaseDb, organizationId: string): Promise<Signal[]> {
  const { data, error } = await supabase
    .from("ai_signals")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .order("severity", { ascending: false })
    .order("observed_at", { ascending: false });

  if (error) throw toOperationalError(error);
  return data ?? [];
}

export async function listRecommendations(
  supabase: SupabaseDb,
  organizationId: string,
  options?: { status?: string },
): Promise<Recommendation[]> {
  let query = supabase
    .from("ai_recommendations")
    .select("*")
    .eq("organization_id", organizationId)
    .order("priority_score", { ascending: false })
    .order("created_at", { ascending: false });

  if (options?.status) {
    query = query.eq("status", options.status);
  }

  const { data, error } = await query;
  if (error) throw toOperationalError(error);
  return data ?? [];
}

export interface PendingApproval {
  approval: Approval;
  recommendation: Recommendation;
}

/**
 * Two plain queries + an in-memory join, deliberately — not a PostgREST
 * embedded select. Keeps this service layer's typing independent of the
 * hand-authored database.types.ts Relationships arrays being byte-for-byte
 * accurate (same reasoning Phase 3's lib/operations/orders.ts documented).
 */
export async function listPendingApprovals(supabase: SupabaseDb, organizationId: string): Promise<PendingApproval[]> {
  const { data: approvals, error: approvalsError } = await supabase
    .from("ai_approvals")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("status", "pending");

  if (approvalsError) throw toOperationalError(approvalsError);
  if (!approvals || approvals.length === 0) return [];

  const recommendationIds = approvals.map((approval) => approval.recommendation_id);
  const { data: recommendations, error: recommendationsError } = await supabase
    .from("ai_recommendations")
    .select("*")
    .eq("organization_id", organizationId)
    .in("id", recommendationIds);

  if (recommendationsError) throw toOperationalError(recommendationsError);

  const recommendationById = new Map((recommendations ?? []).map((rec) => [rec.id, rec]));

  return approvals
    .map((approval) => {
      const recommendation = recommendationById.get(approval.recommendation_id);
      return recommendation ? { approval, recommendation } : null;
    })
    .filter((entry): entry is PendingApproval => entry !== null);
}

export interface RecommendationDetail {
  recommendation: Recommendation;
  evidence: Evidence[];
  approval: Approval | null;
  outcome: Outcome | null;
}

export async function getRecommendationDetail(
  supabase: SupabaseDb,
  organizationId: string,
  recommendationId: string,
): Promise<RecommendationDetail | null> {
  const { data: recommendation, error: recError } = await supabase
    .from("ai_recommendations")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("id", recommendationId)
    .maybeSingle();

  if (recError) throw toOperationalError(recError);
  if (!recommendation) return null;

  const [{ data: evidence, error: evidenceError }, { data: approval, error: approvalError }, { data: outcome, error: outcomeError }] =
    await Promise.all([
      supabase.from("ai_recommendation_evidence").select("*").eq("recommendation_id", recommendationId),
      supabase.from("ai_approvals").select("*").eq("recommendation_id", recommendationId).maybeSingle(),
      supabase.from("ai_outcomes").select("*").eq("recommendation_id", recommendationId).maybeSingle(),
    ]);

  if (evidenceError) throw toOperationalError(evidenceError);
  if (approvalError) throw toOperationalError(approvalError);
  if (outcomeError) throw toOperationalError(outcomeError);

  return { recommendation, evidence: evidence ?? [], approval: approval ?? null, outcome: outcome ?? null };
}
