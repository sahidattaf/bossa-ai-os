import { changeOrderStatusPayloadV1 } from "../schemas";
import type { AiActionModule } from "./types";

export const changeOrderStatusAction: AiActionModule<{ orderId: string; status: string }> = {
  actionType: "change_order_status",
  payloadSchema: changeOrderStatusPayloadV1,
};
