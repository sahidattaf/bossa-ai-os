import { cancelReservation } from "@/lib/operations/reservations";

import { cancelReservationPayloadV1 } from "../schemas";
import type { AiActionModule } from "./types";

export const cancelReservationAction: AiActionModule<{ reservationId: string }> = {
  actionType: "cancel_reservation",
  payloadSchema: cancelReservationPayloadV1,
  async execute(supabase, organizationId, payload) {
    const reservation = await cancelReservation(supabase, organizationId, payload.reservationId);
    return { reservationId: reservation.id, status: reservation.status };
  },
};
