import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { OPERATIONAL_ERROR_CODES, OperationalError, toOperationalError, type OperationalErrorCode } from "@/lib/errors";
import type { Database } from "@/lib/supabase/database.types";

import { assignLeadOwnerAction } from "./actions/assign-lead-owner";
import { cancelReservationAction } from "./actions/cancel-reservation";
import { changeLeadStatusAction } from "./actions/change-lead-status";
import { changeOrderPaymentStatusAction } from "./actions/change-order-payment-status";
import { changeOrderStatusAction } from "./actions/change-order-status";
import { confirmReservationAction } from "./actions/confirm-reservation";
import { navigateAction } from "./actions/navigate";
import { regenerateKpiSnapshotAction } from "./actions/regenerate-kpi-snapshot";
import type { AiActionModule } from "./actions/types";
import { AI_ACTION_TYPES, type AiActionType } from "./status";

type SupabaseDb = SupabaseClient<Database>;

/**
 * The compiled allow-list (issue #18 decision #8). This Record is
 * exhaustive over AiActionType at the type level — adding a new value to
 * AI_ACTION_TYPES without a matching module here is a compile error, so the
 * router can never accidentally fall through to "unknown action type" for
 * something that was actually meant to be supported.
 */
const ACTION_MODULES: Record<AiActionType, AiActionModule<never>> = {
  assign_lead_owner: assignLeadOwnerAction as AiActionModule<never>,
  change_lead_status: changeLeadStatusAction as AiActionModule<never>,
  confirm_reservation: confirmReservationAction as AiActionModule<never>,
  cancel_reservation: cancelReservationAction as AiActionModule<never>,
  change_order_status: changeOrderStatusAction as AiActionModule<never>,
  change_order_payment_status: changeOrderPaymentStatusAction as AiActionModule<never>,
  regenerate_kpi_snapshot: regenerateKpiSnapshotAction as AiActionModule<never>,
  navigate: navigateAction as AiActionModule<never>,
};

export interface ExecuteRecommendationResult {
  status: "succeeded" | "failed";
  actionAttemptId: string;
  error?: OperationalError;
}

function isOperationalErrorCode(code: string | null): code is OperationalErrorCode {
  return code !== null && (OPERATIONAL_ERROR_CODES as readonly string[]).includes(code);
}

/**
 * The guarded action router. Rejects arbitrary function names, SQL, URLs,
 * prompts, tool names, or unknown action types before any write occurs —
 * `recommended_action_type` must be one of AI_ACTION_TYPES and its stored
 * payload must still validate against that type's own versioned zod schema.
 *
 * Approval and execution are two distinct durable operations (decision #3):
 * approving a recommendation (lib/ai/approvals.ts) only ever flips
 * ai_approvals/ai_recommendations to 'approved' — nothing here runs until
 * this function is called separately. begin_ai_recommendation_execution()
 * re-verifies ai.actions.approve, the approval's live status, and its
 * snapshotted payload_hash against the recommendation's *current*
 * payload_hash server-side before anything executes.
 *
 * The domain mutation itself happens inside finalize_ai_recommendation_execution()
 * (supabase/migrations/20260725000001_ai_transactional_action_execution.sql),
 * not here — token validation, the mutation, ai_action_attempts, the status
 * transition, and the audit event are all one atomic transaction, so a
 * crash or lost response between the mutation and recording it can never
 * leave a committed-but-unrecorded effect. This router calls exactly one
 * well-known RPC name for every database-native action type — never a
 * dynamically-constructed function name.
 *
 * Retry-safety comes from the recommendation's own status machine, not a
 * separate hash lookup: 'completed' is terminal (no re-entry into
 * 'executing'), so a second call after a real success is rejected by the
 * same status-transition guard that protects every other status machine in
 * this schema; a failed attempt leaves the recommendation in 'failed', a
 * legal 'failed' -> 'executing' retry starting point.
 */
export async function executeAiRecommendation(
  supabase: SupabaseDb,
  recommendationId: string,
): Promise<ExecuteRecommendationResult> {
  const { data: recommendation, error: loadError } = await supabase
    .from("ai_recommendations")
    .select("*")
    .eq("id", recommendationId)
    .single();

  if (loadError) throw toOperationalError(loadError);

  const actionType = recommendation.recommended_action_type;
  if (!(AI_ACTION_TYPES as readonly string[]).includes(actionType)) {
    throw new OperationalError("VALIDATION_FAILED", `Unknown or unsupported action type "${actionType}".`);
  }
  if (actionType === "navigate") {
    throw new OperationalError(
      "VALIDATION_FAILED",
      "navigate recommendations are read-only and never execute — render the link directly.",
    );
  }

  const actionModule = ACTION_MODULES[actionType as AiActionType];
  const payloadResult = actionModule.payloadSchema.safeParse(recommendation.recommended_action_payload);
  if (!payloadResult.success) {
    throw new OperationalError(
      "VALIDATION_FAILED",
      `Stored action payload no longer matches "${actionType}"'s schema: ${payloadResult.error.message}`,
    );
  }

  // Durable step 1 (already happened, separately): approval. Durable step 2
  // starts here — server-verifies eligibility and atomically claims the
  // approved/failed -> executing transition, minting a fresh
  // execution_token. A concurrent second claim attempt on the same
  // recommendation raises here (CONFLICT) before any domain mutation is
  // ever attempted.
  const { data: claimed, error: beginError } = await supabase.rpc("begin_ai_recommendation_execution", {
    p_recommendation_id: recommendationId,
  });
  if (beginError) throw toOperationalError(beginError);

  // execution_token is nullable in the column's generated type (it's cleared
  // by recover_stalled_ai_execution()), but begin_ai_recommendation_execution()
  // always mints a fresh one as part of the same atomic claim this call just
  // won — guaranteed non-null immediately after a successful claim.
  const executionToken = claimed.execution_token!;

  // Durable step 3: the mutation, attempt recording, and status transition,
  // atomically. A thrown error here means the whole call was rejected before
  // committing anything (e.g. a lost claim race) — genuinely nothing
  // happened. A returned 'failed' result_status means the mutation itself
  // was attempted and failed for a business reason (already recorded
  // honestly, not thrown), matching the pre-existing distinction between "no
  // attempt happened" and "an attempt happened and failed".
  const { data: attempt, error: finalizeError } = await supabase.rpc("finalize_ai_recommendation_execution", {
    p_recommendation_id: recommendationId,
    p_execution_token: executionToken,
  });
  if (finalizeError) throw toOperationalError(finalizeError);

  if (attempt.result_status === "succeeded") {
    return { status: "succeeded", actionAttemptId: attempt.id };
  }

  const errorCode = isOperationalErrorCode(attempt.error_code) ? attempt.error_code : "UNEXPECTED_ERROR";
  return {
    status: "failed",
    actionAttemptId: attempt.id,
    error: new OperationalError(errorCode, attempt.error_message ?? "The action attempt failed."),
  };
}

/**
 * Narrow, permissioned recovery from a crashed/abandoned execution claim
 * (issue: a process that crashes between begin_ai_recommendation_execution()
 * and record_ai_action_attempt() leaves a recommendation stuck 'executing'
 * with no normal retry path). Requires ai.recommendations.manage and an
 * execution older than ai_execution_lease_duration() — see
 * docs/AI_APPROVAL_AND_ACTION_SECURITY.md.
 */
export async function recoverStalledAiExecution(
  supabase: SupabaseDb,
  recommendationId: string,
): Promise<Database["public"]["Tables"]["ai_recommendations"]["Row"]> {
  const { data, error } = await supabase.rpc("recover_stalled_ai_execution", {
    p_recommendation_id: recommendationId,
  });
  if (error) throw toOperationalError(error);
  return data;
}
