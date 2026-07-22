import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { validationFailedError } from "@/lib/errors";
import type { Database } from "@/lib/supabase/database.types";

import { getLead, updateLeadStatus } from "./leads";
import type { OrderWithItems } from "./orders";
import { createOrder } from "./orders";
import { createReservation } from "./reservations";

type Reservation = Database["public"]["Tables"]["reservations"]["Row"];
type SupabaseDb = SupabaseClient<Database>;

/**
 * Creates the reservation, then moves the source lead to "converted" (a
 * legal transition from "contacted" or "qualified" per status_transitions —
 * an illegal starting status surfaces as INVALID_STATUS_TRANSITION from
 * updateLeadStatus). The conversion link itself (lead.converted_to_*) is a
 * distinct, service-recorded audit event, not a duplicate of the status
 * trigger's own "lead.status_changed" entry.
 */
export async function convertLeadToReservation(
  supabase: SupabaseDb,
  organizationId: string,
  leadId: string,
  input: unknown,
): Promise<Reservation> {
  const lead = await getLead(supabase, organizationId, leadId);
  if (!lead) {
    throw validationFailedError(`Lead ${leadId} was not found in this organization.`);
  }

  const reservation = await createReservation(supabase, organizationId, { ...(input as object), leadId });
  await updateLeadStatus(supabase, organizationId, leadId, "converted");

  await supabase.rpc("record_audit_event", {
    p_organization_id: organizationId,
    p_action: "lead.converted_to_reservation",
    p_entity_type: "lead",
    p_entity_id: leadId,
    p_metadata: { reservation_id: reservation.id },
  });

  return reservation;
}

export async function convertLeadToOrder(
  supabase: SupabaseDb,
  organizationId: string,
  leadId: string,
  input: unknown,
): Promise<OrderWithItems> {
  const lead = await getLead(supabase, organizationId, leadId);
  if (!lead) {
    throw validationFailedError(`Lead ${leadId} was not found in this organization.`);
  }

  const result = await createOrder(supabase, organizationId, { ...(input as object), leadId });
  await updateLeadStatus(supabase, organizationId, leadId, "converted");

  await supabase.rpc("record_audit_event", {
    p_organization_id: organizationId,
    p_action: "lead.converted_to_order",
    p_entity_type: "lead",
    p_entity_id: leadId,
    p_metadata: { order_id: result.order.id },
  });

  return result;
}
