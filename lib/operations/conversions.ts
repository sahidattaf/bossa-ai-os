import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { OperationalError, toOperationalError, validationFailedError } from "@/lib/errors";
import type { Database } from "@/lib/supabase/database.types";

import { getLead } from "./leads";
import type { OrderWithItems } from "./orders";
import { createOrder } from "./orders";
import { createReservation } from "./reservations";
import type { LeadStatus } from "./status";

type Lead = Database["public"]["Tables"]["leads"]["Row"];
type Reservation = Database["public"]["Tables"]["reservations"]["Row"];
type SupabaseDb = SupabaseClient<Database>;

/** Lead statuses a conversion may legally start from — see status_transitions' lead_status rows. */
export const CONVERTIBLE_LEAD_STATUSES: readonly LeadStatus[] = ["contacted", "qualified"];

export function isLeadConvertible(status: string): boolean {
  return (CONVERTIBLE_LEAD_STATUSES as readonly string[]).includes(status);
}

/**
 * Flips the lead to "converted", gated by an optimistic-concurrency check on
 * the exact status this caller last read (`.eq("status", expectedStatus)`).
 * This — not a UI-level check — is what actually prevents a duplicate
 * conversion: two concurrent conversion attempts on the same lead both read
 * status "contacted", but only one's UPDATE can match that row (Postgres
 * serializes the two UPDATEs via row locking); the second matches zero rows
 * and gets a typed CONFLICT here, before it ever creates a reservation/order.
 * Doing this *before* creating the reservation/order (rather than after, as
 * a plain status-then-audit update would) is what closes the race — the
 * losing request never creates an orphaned record at all.
 *
 * An illegal starting status (e.g. a lead still "new") is caught by
 * public.enforce_status_transition() and surfaces as
 * INVALID_STATUS_TRANSITION instead.
 */
async function claimLeadConversion(
  supabase: SupabaseDb,
  organizationId: string,
  leadId: string,
  expectedStatus: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("leads")
    .update({ status: "converted" })
    .eq("organization_id", organizationId)
    .eq("id", leadId)
    .eq("status", expectedStatus)
    .select("id")
    .maybeSingle();

  if (error) throw toOperationalError(error);
  if (!data) {
    throw new OperationalError(
      "CONFLICT",
      "This lead has already been converted or its status changed since it was loaded. Refresh and try again.",
    );
  }
}

async function loadConvertibleLead(supabase: SupabaseDb, organizationId: string, leadId: string): Promise<Lead> {
  const lead = await getLead(supabase, organizationId, leadId);
  if (!lead) {
    throw validationFailedError(`Lead ${leadId} was not found in this organization.`);
  }
  if (!isLeadConvertible(lead.status)) {
    throw validationFailedError(
      `Lead ${leadId} cannot be converted from status "${lead.status}" (must be "contacted" or "qualified").`,
    );
  }
  return lead;
}

/**
 * Converts a lead into a reservation. The reservation retains the source
 * lead relationship (`reservation.lead_id`) and inherits the same
 * organization scope as the lead — enforced by the composite FK
 * `(organization_id, lead_id) references leads(organization_id, id)`
 * (20260722000001), so a cross-tenant reference is structurally impossible,
 * not just an application convention. The conversion link itself
 * (`lead.converted_to_reservation`) is a distinct, service-recorded audit
 * event — not a duplicate of the status trigger's own `lead.status_changed`
 * entry for the "converted" transition claimLeadConversion just made.
 */
export async function convertLeadToReservation(
  supabase: SupabaseDb,
  organizationId: string,
  leadId: string,
  input: unknown,
): Promise<Reservation> {
  const lead = await loadConvertibleLead(supabase, organizationId, leadId);
  await claimLeadConversion(supabase, organizationId, leadId, lead.status);

  const reservation = await createReservation(supabase, organizationId, { ...(input as object), leadId });

  await supabase.rpc("record_audit_event", {
    p_organization_id: organizationId,
    p_action: "lead.converted_to_reservation",
    p_entity_type: "lead",
    p_entity_id: leadId,
    p_metadata: { reservation_id: reservation.id },
  });

  return reservation;
}

/** See convertLeadToReservation — same guarantees, targeting an order instead. */
export async function convertLeadToOrder(
  supabase: SupabaseDb,
  organizationId: string,
  leadId: string,
  input: unknown,
): Promise<OrderWithItems> {
  const lead = await loadConvertibleLead(supabase, organizationId, leadId);
  await claimLeadConversion(supabase, organizationId, leadId, lead.status);

  const result = await createOrder(supabase, organizationId, { ...(input as object), leadId });

  await supabase.rpc("record_audit_event", {
    p_organization_id: organizationId,
    p_action: "lead.converted_to_order",
    p_entity_type: "lead",
    p_entity_id: leadId,
    p_metadata: { order_id: result.order.id },
  });

  return result;
}
