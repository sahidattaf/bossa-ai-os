import { assignLeadOwnerPayloadV1 } from "../schemas";
import type { AiActionModule } from "./types";

export const assignLeadOwnerAction: AiActionModule<{ leadId: string; ownerUserId: string }> = {
  actionType: "assign_lead_owner",
  payloadSchema: assignLeadOwnerPayloadV1,
};
