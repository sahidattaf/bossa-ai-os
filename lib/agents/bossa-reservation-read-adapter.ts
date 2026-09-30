import "server-only";

import { z } from "zod";

export const BOSSA_RESERVATION_READ_ADAPTER_ID = "BOSSA-RESERVATION-READ-ADAPTER-v1" as const;
export const PRIMARY_PROJECT_ID = "BOSSA-WEB-001" as const;
export const SECONDARY_PROJECT_ID = "BOSSA-PLATFORM-001" as const;
export const REQUIRED_PERMISSION = "reservations.read" as const;

// Synthetic-only tenant boundary for this validation gate. A future live adapter
// must resolve the real organization from an authenticated, owner-approved
// runtime context rather than accepting an organization id from the agent.
export const SYNTHETIC_BOSSA_ORGANIZATION_ID =
  "11111111-1111-4111-8111-111111111111" as const;

// This is the exact future database projection. Deliberately no select("*").
export const RESERVATION_READ_COLUMNS =
  "id,status,reservation_at,party_size,created_at,updated_at" as const;

const reservationStatusSchema = z.enum([
  "pending",
  "confirmed",
  "seated",
  "completed",
  "cancelled",
  "no_show",
]);

const syntheticReservationRowSchema = z
  .object({
    id: z.string().uuid(),
    organization_id: z.string().uuid(),
    status: reservationStatusSchema,
    reservation_at: z.string().datetime({ offset: true }),
    party_size: z.number().int().positive(),
    created_at: z.string().datetime({ offset: true }),
    updated_at: z.string().datetime({ offset: true }),
  })
  // The canonical database row contains PII and operational fields that the
  // adapter is forbidden to expose. Passthrough lets synthetic tests prove
  // those fields can be present on input while remaining absent from output.
  .passthrough();

const readRequestSchema = z
  .object({
    operation: z.literal("read"),
    reservationRef: z.string().uuid(),
  })
  .strict();

export type ReservationReadProjection = {
  reservation_ref: string;
  reservation_status: z.infer<typeof reservationStatusSchema>;
  service_date: string;
  service_time: string;
  party_size: number;
  created_at: string;
  updated_at: string;
};

export type ReservationReadEnvelope =
  | {
      ok: true;
      adapter_id: typeof BOSSA_RESERVATION_READ_ADAPTER_ID;
      primary_project_id: typeof PRIMARY_PROJECT_ID;
      secondary_project_id: typeof SECONDARY_PROJECT_ID;
      permission_required: typeof REQUIRED_PERMISSION;
      execution_class: "READ";
      data: ReservationReadProjection;
    }
  | {
      ok: false;
      adapter_id: typeof BOSSA_RESERVATION_READ_ADAPTER_ID;
      primary_project_id: typeof PRIMARY_PROJECT_ID;
      secondary_project_id: typeof SECONDARY_PROJECT_ID;
      permission_required: typeof REQUIRED_PERMISSION;
      execution_class: "READ";
      error_code:
        | "INVALID_REQUEST"
        | "NOT_FOUND"
        | "TENANT_SCOPE_DENIED"
        | "MALFORMED_RESERVATION";
    };

function baseEnvelope() {
  return {
    adapter_id: BOSSA_RESERVATION_READ_ADAPTER_ID,
    primary_project_id: PRIMARY_PROJECT_ID,
    secondary_project_id: SECONDARY_PROJECT_ID,
    permission_required: REQUIRED_PERMISSION,
    execution_class: "READ" as const,
  };
}

function projectReservation(row: z.infer<typeof syntheticReservationRowSchema>): ReservationReadProjection {
  const reservationAt = new Date(row.reservation_at);
  const iso = reservationAt.toISOString();

  return {
    reservation_ref: row.id,
    reservation_status: row.status,
    service_date: iso.slice(0, 10),
    service_time: iso.slice(11, 16),
    party_size: row.party_size,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Synthetic-only validation adapter.
 *
 * It accepts fictional in-memory rows so this gate can prove the projection,
 * tenant boundary and fail-closed behavior without creating a Supabase client,
 * reading production data or making a network request.
 */
export function readSyntheticReservation(
  request: unknown,
  syntheticRows: readonly unknown[],
): ReservationReadEnvelope {
  const parsedRequest = readRequestSchema.safeParse(request);
  if (!parsedRequest.success) {
    return { ok: false, ...baseEnvelope(), error_code: "INVALID_REQUEST" };
  }

  const candidate = syntheticRows.find((row) => {
    if (!row || typeof row !== "object") return false;
    return (row as Record<string, unknown>).id === parsedRequest.data.reservationRef;
  });

  if (!candidate) {
    return { ok: false, ...baseEnvelope(), error_code: "NOT_FOUND" };
  }

  const parsedRow = syntheticReservationRowSchema.safeParse(candidate);
  if (!parsedRow.success) {
    return { ok: false, ...baseEnvelope(), error_code: "MALFORMED_RESERVATION" };
  }

  if (parsedRow.data.organization_id !== SYNTHETIC_BOSSA_ORGANIZATION_ID) {
    return { ok: false, ...baseEnvelope(), error_code: "TENANT_SCOPE_DENIED" };
  }

  return {
    ok: true,
    ...baseEnvelope(),
    data: projectReservation(parsedRow.data),
  };
}
