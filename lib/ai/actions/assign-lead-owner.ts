import { updateLead } from "@/lib/operations/leads";

import { assignLeadOwnerPayloadV1 } from "../schemas";
import type { AiActionModule } from "./types";

export const assignLeadOwnerAction: AiActionModule<{ leadId: string; ownerUserId: string }> = {
  actionType: "assign_lead_owner",
  payloadSchema: assignLeadOwnerPayloadV1,
  async execute(supabase, organizationId, payload) {
    const lead = await updateLead(supabase, organizationId, payload.leadId, { ownerUserId: payload.ownerUserId });
    return { leadId: lead.id, ownerUserId: lead.owner_user_id };
  },
};
