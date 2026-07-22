import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { toOperationalError } from "@/lib/errors";
import type { Database } from "@/lib/supabase/database.types";

import { createReservationSchema, reservationStatusSchema, updateReservationSchema } from "./schemas";
import { parseInput } from "./validate";

type Reservation = Database["public"]["Tables"]["reservations"]["Row"];
type SupabaseDb = SupabaseClient<Database>;

export async function listReservations(
  supabase: SupabaseDb,
  organizationId: string,
  options?: { status?: string },
): Promise<Reservation[]> {
  let query = supabase
    .from("reservations")
    .select("*")
    .eq("organization_id", organizationId)
    .order("reservation_at", { ascending: true });

  if (options?.status) {
    query = query.eq("status", options.status);
  }

  const { data, error } = await query;
  if (error) throw toOperationalError(error);
  return data ?? [];
}

export async function getReservation(
  supabase: SupabaseDb,
  organizationId: string,
  reservationId: string,
): Promise<Reservation | null> {
  const { data, error } = await supabase
    .from("reservations")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("id", reservationId)
    .maybeSingle();

  if (error) throw toOperationalError(error);
  return data;
}

function generateConfirmationCode(): string {
  return `RES-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

export async function createReservation(
  supabase: SupabaseDb,
  organizationId: string,
  input: unknown,
): Promise<Reservation> {
  const parsed = parseInput(createReservationSchema, input);

  const { data, error } = await supabase
    .from("reservations")
    .insert({
      organization_id: organizationId,
      location_id: parsed.locationId,
      lead_id: parsed.leadId ?? null,
      confirmation_code: generateConfirmationCode(),
      guest_name: parsed.guestName,
      phone: parsed.phone,
      email: parsed.email ?? null,
      party_size: parsed.partySize,
      reservation_at: parsed.reservationAt,
      duration_minutes: parsed.durationMinutes ?? undefined,
      occasion: parsed.occasion ?? null,
      notes: parsed.notes ?? null,
      source: parsed.source,
      assigned_user_id: parsed.assignedUserId ?? null,
    })
    .select("*")
    .single();

  if (error) throw toOperationalError(error);

  await supabase.rpc("record_audit_event", {
    p_organization_id: organizationId,
    p_action: "reservation.created",
    p_entity_type: "reservation",
    p_entity_id: data.id,
    p_metadata: { party_size: parsed.partySize, reservation_at: parsed.reservationAt },
  });

  return data;
}

export async function updateReservation(
  supabase: SupabaseDb,
  organizationId: string,
  reservationId: string,
  input: unknown,
): Promise<Reservation> {
  const parsed = parseInput(updateReservationSchema, input);

  const patch: Database["public"]["Tables"]["reservations"]["Update"] = {};
  if (parsed.locationId !== undefined) patch.location_id = parsed.locationId;
  if (parsed.guestName !== undefined) patch.guest_name = parsed.guestName;
  if (parsed.phone !== undefined) patch.phone = parsed.phone;
  if (parsed.email !== undefined) patch.email = parsed.email;
  if (parsed.partySize !== undefined) patch.party_size = parsed.partySize;
  if (parsed.reservationAt !== undefined) patch.reservation_at = parsed.reservationAt;
  if (parsed.durationMinutes !== undefined) patch.duration_minutes = parsed.durationMinutes;
  if (parsed.occasion !== undefined) patch.occasion = parsed.occasion;
  if (parsed.notes !== undefined) patch.notes = parsed.notes;
  if (parsed.source !== undefined) patch.source = parsed.source;
  if (parsed.assignedUserId !== undefined) patch.assigned_user_id = parsed.assignedUserId;

  const { data, error } = await supabase
    .from("reservations")
    .update(patch)
    .eq("organization_id", organizationId)
    .eq("id", reservationId)
    .select("*")
    .single();

  if (error) throw toOperationalError(error);
  return data;
}

/** See lib/operations/leads.ts's updateLeadStatus for why this doesn't call record_audit_event() itself. */
export async function updateReservationStatus(
  supabase: SupabaseDb,
  organizationId: string,
  reservationId: string,
  status: unknown,
): Promise<Reservation> {
  const parsedStatus = parseInput(reservationStatusSchema, status);

  const { data, error } = await supabase
    .from("reservations")
    .update({ status: parsedStatus })
    .eq("organization_id", organizationId)
    .eq("id", reservationId)
    .select("*")
    .single();

  if (error) throw toOperationalError(error);
  return data;
}

export async function cancelReservation(
  supabase: SupabaseDb,
  organizationId: string,
  reservationId: string,
): Promise<Reservation> {
  return updateReservationStatus(supabase, organizationId, reservationId, "cancelled");
}
