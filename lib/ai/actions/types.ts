import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";

import type { Database } from "@/lib/supabase/database.types";

import type { AiActionType } from "../status";

export interface AiActionModule<TPayload> {
  actionType: AiActionType;
  payloadSchema: z.ZodType<TPayload>;
  /** Calls an existing lib/operations function with the caller's own session-bound client — never a service-role client, never a new mutation path. Returns a plain JSON-serializable result stored in ai_action_attempts.result_detail. */
  execute(supabase: SupabaseClient<Database>, organizationId: string, payload: TPayload): Promise<Record<string, unknown>>;
}
