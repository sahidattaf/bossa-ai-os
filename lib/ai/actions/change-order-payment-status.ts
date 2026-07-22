import { updateOrderPaymentStatus } from "@/lib/operations/orders";

import { changeOrderPaymentStatusPayloadV1 } from "../schemas";
import type { AiActionModule } from "./types";

export const changeOrderPaymentStatusAction: AiActionModule<{ orderId: string; paymentStatus: string }> = {
  actionType: "change_order_payment_status",
  payloadSchema: changeOrderPaymentStatusPayloadV1,
  async execute(supabase, organizationId, payload) {
    const order = await updateOrderPaymentStatus(supabase, organizationId, payload.orderId, payload.paymentStatus);
    return { orderId: order.id, paymentStatus: order.payment_status };
  },
};
