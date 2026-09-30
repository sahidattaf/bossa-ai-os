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

// This is the exact future database projection. Wildcard selection is forbidden.
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
  .passthrough();

const readRequestSchema = z
  .object({
    operation: z.literal("read"),
    reservationRef: z.string().uuid(),
  })
  .strict();

const trustedLocationContextSchema = z
  .object({
    timezone: z.string().min(1),
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
        | "MALFORMED_RESERVATION"
        | "MISSING_TIMEZONE"
        | "INVALID_TIMEZONE";
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

function formatReservationLocal(
  reservationAt: string,
  timezone: string,
): { service_date: string; service_time: string } | null {
  try {
    const date = new Date(reservationAt);
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);

    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const year = values.year;
    const month = values.month;
    const day = values.day;
    const hour = values.hour;
    const minute = values.minute;

    if (!year || !month || !day || !hour || !minute) return null;

    return {
      service_date: `${year}-${month}-${day}`,
      service_time: `${hour}:${minute}`,
    };
  } catch {
    return null;
  }
}

function projectReservation(
  row: z.infer<typeof syntheticReservationRowSchema>,
  timezone: string,
): ReservationReadProjection | null {
  const local = formatReservationLocal(row.reservation_at, timezone);
  if (!local) return null;

  return {
    reservation_ref: row.id,
    reservation_status: row.status,
    service_date: local.service_date,
    service_time: local.service_time,
    party_size: row.party_size,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Synthetic-only validation adapter.
 *
 * The timezone is supplied separately as trusted location context, mirroring
 * the canonical locations.timezone source. Agent request data cannot set or
 * override it.
 */
export function readSyntheticReservation(
  request: unknown,
  syntheticRows: readonly unknown[],
  trustedLocationContext?: unknown,
): ReservationReadEnvelope {
  const parsedRequest = readRequestSchema.safeParse(request);
  if (!parsedRequest.success) {
    return { ok: false, ...baseEnvelope(), error_code: "INVALID_REQUEST" };
  }

  if (trustedLocationContext === undefined || trustedLocationContext === null) {
    return { ok: false, ...baseEnvelope(), error_code: "MISSING_TIMEZONE" };
  }

  const parsedContext = trustedLocationContextSchema.safeParse(trustedLocationContext);
  if (!parsedContext.success) {
    return { ok: false, ...baseEnvelope(), error_code: "INVALID_TIMEZONE" };
  }

  // Validate the IANA timezone independently of row lookup so bad trusted
  // context fails closed before any reservation projection is attempted.
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: parsedContext.data.timezone }).format(new Date(0));
  } catch {
    return { ok: false, ...baseEnvelope(), error_code: "INVALID_TIMEZONE" };
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

  const data = projectReservation(parsedRow.data, parsedContext.data.timezone);
  if (!data) {
    return { ok: false, ...baseEnvelope(), error_code: "INVALID_TIMEZONE" };
  }

  return {
    ok: true,
    ...baseEnvelope(),
    data,
  };
}
