import type { z } from "zod";

import type { AiActionType } from "../status";

/**
 * The domain mutation itself lives in finalize_ai_recommendation_execution()
 * (supabase/migrations/20260725000001_ai_transactional_action_execution.sql)
 * now, not here — folding token validation, the mutation, attempt
 * recording, and the status transition into one atomic transaction closes
 * the crash window a separate TS-side execute() call left open. This module
 * only declares the action type and its versioned payload schema, used by
 * the router for defense-in-depth client-side validation before ever
 * calling that RPC. See docs/AI_APPROVAL_AND_ACTION_SECURITY.md.
 */
export interface AiActionModule<TPayload> {
  actionType: AiActionType;
  payloadSchema: z.ZodType<TPayload>;
}
