import { changeOrderPaymentStatusPayloadV1 } from "../schemas";
import type { AiActionModule } from "./types";

export const changeOrderPaymentStatusAction: AiActionModule<{ orderId: string; paymentStatus: string }> = {
  actionType: "change_order_payment_status",
  payloadSchema: changeOrderPaymentStatusPayloadV1,
};
