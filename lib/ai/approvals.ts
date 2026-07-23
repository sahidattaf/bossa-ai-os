import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { toOperationalError } from "@/lib/errors";
import type { Database } from "@/lib/supabase/database.types";

import { executeAiRecommendation, type ExecuteRecommendationResult } from "./action-router";

type SupabaseDb = SupabaseClient<Database>;
type Approval = Database["public"]["Tables"]["ai_approvals"]["Row"];
type Recommendation = Database["public"]["Tables"]["ai_recommendations"]["Row"];

/**
 * Thin wrappers over the function-mediated approval transitions (issue #18
 * decision #2) — approve_ai_recommendation()/reject_ai_recommendation()/
 * dismiss_ai_recommendation() are the *only* way ai_approvals/
 * ai_recommendations ever change; there is no direct table grant to fall
 * back to. Each RPC does its own auth.uid()/membership/permission/version/
 * expiry/payload-hash verification server-side.
 */
export async function approveRecommendation(
  supabase: SupabaseDb,
  approvalId: string,
  expectedVersion: number,
): Promise<Approval> {
  const { data, error } = await supabase.rpc("approve_ai_recommendation", {
    p_approval_id: approvalId,
    p_expected_version: expectedVersion,
  });
  if (error) throw toOperationalError(error);
  return data;
}

export async function rejectRecommendation(
  supabase: SupabaseDb,
  approvalId: string,
  expectedVersion: number,
  reason: string,
): Promise<Approval> {
  const { data, error } = await supabase.rpc("reject_ai_recommendation", {
    p_approval_id: approvalId,
    p_expected_version: expectedVersion,
    p_reason: reason,
  });
  if (error) throw toOperationalError(error);
  return data;
}

export async function dismissRecommendation(supabase: SupabaseDb, recommendationId: string): Promise<Recommendation> {
  const { data, error } = await supabase.rpc("dismiss_ai_recommendation", {
    p_recommendation_id: recommendationId,
  });
  if (error) throw toOperationalError(error);
  return data;
}

export interface ApproveAndExecuteResult {
  approval: Approval;
  execution: ExecuteRecommendationResult;
}

/**
 * The UI's single "Approve & Execute" button (issue #18 decision #3) — but
 * underneath, still two distinct, durable backend operations run in
 * sequence, not one collapsed state change. If execution fails, the
 * approval this call already persisted stays 'approved' and visible; only
 * the recommendation moves to 'failed', which is a legal retry starting
 * point (see action-router.ts). A caller that only wants the durable
 * approval without immediately executing should call approveRecommendation()
 * directly instead.
 */
export async function approveAndExecuteRecommendation(
  supabase: SupabaseDb,
  approvalId: string,
  expectedVersion: number,
): Promise<ApproveAndExecuteResult> {
  const approval = await approveRecommendation(supabase, approvalId, expectedVersion);
  const execution = await executeAiRecommendation(supabase, approval.recommendation_id);
  return { approval, execution };
}
