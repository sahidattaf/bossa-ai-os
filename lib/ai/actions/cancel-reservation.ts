import { cancelReservationPayloadV1 } from "../schemas";
import type { AiActionModule } from "./types";

export const cancelReservationAction: AiActionModule<{ reservationId: string }> = {
  actionType: "cancel_reservation",
  payloadSchema: cancelReservationPayloadV1,
};
