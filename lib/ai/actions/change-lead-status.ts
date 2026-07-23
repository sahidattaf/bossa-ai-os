import { changeLeadStatusPayloadV1 } from "../schemas";
import type { AiActionModule } from "./types";

export const changeLeadStatusAction: AiActionModule<{ leadId: string; status: string }> = {
  actionType: "change_lead_status",
  payloadSchema: changeLeadStatusPayloadV1,
};
