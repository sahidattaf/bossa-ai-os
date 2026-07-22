import { updateReservationStatus } from "@/lib/operations/reservations";

import { confirmReservationPayloadV1 } from "../schemas";
import type { AiActionModule } from "./types";

export const confirmReservationAction: AiActionModule<{ reservationId: string }> = {
  actionType: "confirm_reservation",
  payloadSchema: confirmReservationPayloadV1,
  async execute(supabase, organizationId, payload) {
    const reservation = await updateReservationStatus(supabase, organizationId, payload.reservationId, "confirmed");
    return { reservationId: reservation.id, status: reservation.status };
  },
};
