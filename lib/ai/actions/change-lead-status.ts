import { updateLeadStatus } from "@/lib/operations/leads";

import { changeLeadStatusPayloadV1 } from "../schemas";
import type { AiActionModule } from "./types";

export const changeLeadStatusAction: AiActionModule<{ leadId: string; status: string }> = {
  actionType: "change_lead_status",
  payloadSchema: changeLeadStatusPayloadV1,
  async execute(supabase, organizationId, payload) {
    const lead = await updateLeadStatus(supabase, organizationId, payload.leadId, payload.status);
    return { leadId: lead.id, status: lead.status };
  },
};
