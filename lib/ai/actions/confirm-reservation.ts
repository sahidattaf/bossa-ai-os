import { confirmReservationPayloadV1 } from "../schemas";
import type { AiActionModule } from "./types";

export const confirmReservationAction: AiActionModule<{ reservationId: string }> = {
  actionType: "confirm_reservation",
  payloadSchema: confirmReservationPayloadV1,
};
