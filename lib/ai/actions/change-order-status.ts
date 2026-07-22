import { updateOrderStatus } from "@/lib/operations/orders";

import { changeOrderStatusPayloadV1 } from "../schemas";
import type { AiActionModule } from "./types";

export const changeOrderStatusAction: AiActionModule<{ orderId: string; status: string }> = {
  actionType: "change_order_status",
  payloadSchema: changeOrderStatusPayloadV1,
  async execute(supabase, organizationId, payload) {
    const order = await updateOrderStatus(supabase, organizationId, payload.orderId, payload.status);
    return { orderId: order.id, status: order.status };
  },
};
