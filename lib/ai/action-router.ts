import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { isOperationalError, OperationalError, toOperationalError } from "@/lib/errors";
import type { Database, Json } from "@/lib/supabase/database.types";

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
 * payload_hash server-side before anything executes. Retry-safety comes
 * from the recommendation's own status machine, not a separate hash lookup:
 * 'completed' is terminal (no re-entry into 'executing'), so a second call
 * after a real success is rejected by the same status-transition guard that
 * protects every other status machine in this schema; a failed attempt
 * leaves the recommendation in 'failed', a legal 'failed' -> 'executing'
 * retry starting point.
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
  // starts here — server-verifies eligibility and marks 'executing' before
  // any domain mutation is attempted.
  const { error: beginError } = await supabase.rpc("begin_ai_recommendation_execution", {
    p_recommendation_id: recommendationId,
  });
  if (beginError) throw toOperationalError(beginError);

  const startedAt = Date.now();

  try {
    const resultDetail = await actionModule.execute(supabase, recommendation.organization_id, payloadResult.data);

    const { data: attempt, error: attemptError } = await supabase.rpc("record_ai_action_attempt", {
      p_recommendation_id: recommendationId,
      p_result_status: "succeeded",
      p_result_detail: resultDetail as unknown as Json,
      p_duration_ms: Date.now() - startedAt,
    });
    if (attemptError) throw toOperationalError(attemptError);

    return { status: "succeeded", actionAttemptId: attempt.id };
  } catch (thrown) {
    const operationalError = isOperationalError(thrown)
      ? thrown
      : toOperationalError({ message: thrown instanceof Error ? thrown.message : String(thrown) });

    const { data: attempt, error: attemptError } = await supabase.rpc("record_ai_action_attempt", {
      p_recommendation_id: recommendationId,
      p_result_status: "failed",
      p_error_code: operationalError.code,
      p_error_message: operationalError.message,
      p_duration_ms: Date.now() - startedAt,
    });
    if (attemptError) throw toOperationalError(attemptError);

    return { status: "failed", actionAttemptId: attempt.id, error: operationalError };
  }
}
