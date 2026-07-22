import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { toOperationalError } from "@/lib/errors";
import type { Database } from "@/lib/supabase/database.types";

import { createLeadSchema, leadStatusSchema, updateLeadSchema } from "./schemas";
import { parseInput } from "./validate";

type Lead = Database["public"]["Tables"]["leads"]["Row"];
type SupabaseDb = SupabaseClient<Database>;

export async function listLeads(
  supabase: SupabaseDb,
  organizationId: string,
  options?: { status?: string },
): Promise<Lead[]> {
  let query = supabase
    .from("leads")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });

  if (options?.status) {
    query = query.eq("status", options.status);
  }

  const { data, error } = await query;
  if (error) throw toOperationalError(error);
  return data ?? [];
}

export async function getLead(
  supabase: SupabaseDb,
  organizationId: string,
  leadId: string,
): Promise<Lead | null> {
  const { data, error } = await supabase
    .from("leads")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("id", leadId)
    .maybeSingle();

  if (error) throw toOperationalError(error);
  return data;
}

export async function createLead(
  supabase: SupabaseDb,
  organizationId: string,
  input: unknown,
): Promise<Lead> {
  const parsed = parseInput(createLeadSchema, input);

  const { data, error } = await supabase
    .from("leads")
    .insert({
      organization_id: organizationId,
      location_id: parsed.locationId ?? null,
      lead_type: parsed.leadType,
      source: parsed.source,
      contact_name: parsed.contactName,
      phone: parsed.phone,
      email: parsed.email ?? null,
      guest_count: parsed.guestCount ?? null,
      requested_date: parsed.requestedDate ?? null,
      budget: parsed.budget ?? null,
      message: parsed.message ?? null,
      owner_user_id: parsed.ownerUserId ?? null,
    })
    .select("*")
    .single();

  if (error) throw toOperationalError(error);

  // A creation event, not a status transition — record_audit_event() here
  // does not duplicate anything the leads.status trigger writes (issue #16
  // rule 1), since a brand-new row has no prior status to transition from.
  await supabase.rpc("record_audit_event", {
    p_organization_id: organizationId,
    p_action: "lead.created",
    p_entity_type: "lead",
    p_entity_id: data.id,
    p_metadata: { lead_type: parsed.leadType, source: parsed.source },
  });

  return data;
}

export async function updateLead(
  supabase: SupabaseDb,
  organizationId: string,
  leadId: string,
  input: unknown,
): Promise<Lead> {
  const parsed = parseInput(updateLeadSchema, input);

  const patch: Database["public"]["Tables"]["leads"]["Update"] = {};
  if (parsed.locationId !== undefined) patch.location_id = parsed.locationId;
  if (parsed.leadType !== undefined) patch.lead_type = parsed.leadType;
  if (parsed.source !== undefined) patch.source = parsed.source;
  if (parsed.contactName !== undefined) patch.contact_name = parsed.contactName;
  if (parsed.phone !== undefined) patch.phone = parsed.phone;
  if (parsed.email !== undefined) patch.email = parsed.email;
  if (parsed.guestCount !== undefined) patch.guest_count = parsed.guestCount;
  if (parsed.requestedDate !== undefined) patch.requested_date = parsed.requestedDate;
  if (parsed.budget !== undefined) patch.budget = parsed.budget;
  if (parsed.message !== undefined) patch.message = parsed.message;
  if (parsed.ownerUserId !== undefined) patch.owner_user_id = parsed.ownerUserId;

  const { data, error } = await supabase
    .from("leads")
    .update(patch)
    .eq("organization_id", organizationId)
    .eq("id", leadId)
    .select("*")
    .single();

  if (error) throw toOperationalError(error);
  return data;
}

/**
 * Status-only update. Deliberately does not call record_audit_event() —
 * public.audit_status_transition() (20260722000002) already writes exactly
 * one audit_logs row for this change, after
 * public.enforce_status_transition() has validated it against
 * status_transitions. A database rejection surfaces here as an
 * INVALID_STATUS_TRANSITION OperationalError.
 */
export async function updateLeadStatus(
  supabase: SupabaseDb,
  organizationId: string,
  leadId: string,
  status: unknown,
): Promise<Lead> {
  const parsedStatus = parseInput(leadStatusSchema, status);

  const { data, error } = await supabase
    .from("leads")
    .update({ status: parsedStatus })
    .eq("organization_id", organizationId)
    .eq("id", leadId)
    .select("*")
    .single();

  if (error) throw toOperationalError(error);
  return data;
}
