import { navigatePayloadV1 } from "../schemas";
import type { AiActionModule } from "./types";

/**
 * navigate is a read-only, no_action recommendation type — the action
 * router refuses to ever call execute() for it (see action-router.ts); this
 * module exists only so the compiled allow-list and its payload schema stay
 * exhaustively typed. There is no mutation this action type could perform.
 */
export const navigateAction: AiActionModule<{ route: string; label?: string }> = {
  actionType: "navigate",
  payloadSchema: navigatePayloadV1,
  async execute(_supabase, _organizationId, payload) {
    return { route: payload.route };
  },
};
