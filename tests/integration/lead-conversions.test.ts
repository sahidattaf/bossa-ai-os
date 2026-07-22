import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { isOperationalError } from "@/lib/errors";
import { createLead, updateLeadStatus } from "@/lib/operations/leads";
import { convertLeadToOrder, convertLeadToReservation } from "@/lib/operations/conversions";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Covers the CRM "Convert to Reservation" / "Convert to Order" acceptance
 * criteria: the created record retains the source lead relationship and
 * organization isolation, the conversion is audited, and a duplicate
 * conversion — sequential or racing — is rejected rather than creating a
 * second reservation/order from the same lead.
 */
const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

const DEV_PASSWORD = "DevPassword123!";
const BOSSA_ORG_ID = "00000000-0000-0000-0000-000000000001";
const BOSSA_LOCATION_ID = "00000000-0000-0000-0001-000000000001";

async function signInAs(email: string): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { error } = await client.auth.signInWithPassword({ email, password: DEV_PASSWORD });
  if (error) throw new Error(`Failed to sign in as ${email}: ${error.message}`);
  return client;
}

async function contactedLead(supabase: SupabaseClient<Database>, contactName: string, phone: string) {
  const lead = await createLead(supabase, BOSSA_ORG_ID, {
    leadType: "reservation",
    source: "phone",
    contactName,
    phone,
  });
  return updateLeadStatus(supabase, BOSSA_ORG_ID, lead.id, "contacted");
}

describe("lead conversions (Phase 3A CRM acceptance criterion)", () => {
  let bossaOwner: SupabaseClient<Database>;
  let papaiOwner: SupabaseClient<Database>;

  beforeAll(async () => {
    [bossaOwner, papaiOwner] = await Promise.all([
      signInAs("owner@bossa.test"),
      signInAs("owner@papai.test"),
    ]);
  });

  afterAll(async () => {
    await Promise.all([bossaOwner.auth.signOut(), papaiOwner.auth.signOut()]);
  });

  it("converts a lead to a reservation, retaining the lead relationship and organization scope", async () => {
    const lead = await contactedLead(bossaOwner, "Conversion Test A", "+5990000101");

    const reservation = await convertLeadToReservation(bossaOwner, BOSSA_ORG_ID, lead.id, {
      locationId: BOSSA_LOCATION_ID,
      guestName: "Conversion Test A",
      phone: "+5990000101",
      partySize: 2,
      reservationAt: "2026-08-01T19:00:00Z",
      source: "phone",
    });

    expect(reservation.lead_id).toBe(lead.id);
    expect(reservation.organization_id).toBe(BOSSA_ORG_ID);

    const { data: updatedLead } = await bossaOwner.from("leads").select("status").eq("id", lead.id).single();
    expect(updatedLead?.status).toBe("converted");

    const { data: auditRows } = await bossaOwner
      .from("audit_logs")
      .select("action, entity_id")
      .eq("entity_id", lead.id)
      .eq("action", "lead.converted_to_reservation");
    expect(auditRows).toHaveLength(1);

    // Cross-tenant isolation: Papai can't see the reservation this created.
    const { data: crossTenantRead } = await papaiOwner
      .from("reservations")
      .select("id")
      .eq("id", reservation.id)
      .maybeSingle();
    expect(crossTenantRead).toBeNull();
  });

  it("converts a lead to an order, retaining the lead relationship and organization scope", async () => {
    const lead = await contactedLead(bossaOwner, "Conversion Test B", "+5990000102");

    const { order } = await convertLeadToOrder(bossaOwner, BOSSA_ORG_ID, lead.id, {
      locationId: BOSSA_LOCATION_ID,
      orderNumber: `CONVERT-${Date.now()}`,
      channel: "dine_in",
      fulfillmentType: "dine_in",
      customerName: "Conversion Test B",
      items: [{ itemName: "Conversion Item", quantity: 1, unitPrice: 10 }],
    });

    expect(order.lead_id).toBe(lead.id);
    expect(order.organization_id).toBe(BOSSA_ORG_ID);

    const { data: auditRows } = await bossaOwner
      .from("audit_logs")
      .select("action")
      .eq("entity_id", lead.id)
      .eq("action", "lead.converted_to_order");
    expect(auditRows).toHaveLength(1);
  });

  it("rejects converting a lead that isn't in a convertible status", async () => {
    const lead = await createLead(bossaOwner, BOSSA_ORG_ID, {
      leadType: "reservation",
      source: "phone",
      contactName: "Not Yet Contacted",
      phone: "+5990000103",
    });

    await expect(
      convertLeadToReservation(bossaOwner, BOSSA_ORG_ID, lead.id, {
        locationId: BOSSA_LOCATION_ID,
        guestName: "Not Yet Contacted",
        phone: "+5990000103",
        partySize: 2,
        reservationAt: "2026-08-01T19:00:00Z",
        source: "phone",
      }),
    ).rejects.toSatisfy((error: unknown) => isOperationalError(error) && error.code === "VALIDATION_FAILED");
  });

  it("prevents converting the same lead twice, sequentially", async () => {
    const lead = await contactedLead(bossaOwner, "Sequential Dup Test", "+5990000104");

    await convertLeadToReservation(bossaOwner, BOSSA_ORG_ID, lead.id, {
      locationId: BOSSA_LOCATION_ID,
      guestName: "Sequential Dup Test",
      phone: "+5990000104",
      partySize: 2,
      reservationAt: "2026-08-01T19:00:00Z",
      source: "phone",
    });

    await expect(
      convertLeadToReservation(bossaOwner, BOSSA_ORG_ID, lead.id, {
        locationId: BOSSA_LOCATION_ID,
        guestName: "Sequential Dup Test — second attempt",
        phone: "+5990000104",
        partySize: 2,
        reservationAt: "2026-08-01T20:00:00Z",
        source: "phone",
      }),
    ).rejects.toSatisfy((error: unknown) => isOperationalError(error));
  });

  it("prevents converting the same lead twice under a concurrent race", async () => {
    const lead = await contactedLead(bossaOwner, "Race Dup Test", "+5990000105");

    const attempt = (guestName: string) =>
      convertLeadToReservation(bossaOwner, BOSSA_ORG_ID, lead.id, {
        locationId: BOSSA_LOCATION_ID,
        guestName,
        phone: "+5990000105",
        partySize: 2,
        reservationAt: "2026-08-01T21:00:00Z",
        source: "phone",
      });

    const results = await Promise.allSettled([attempt("Race Winner"), attempt("Race Loser")]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);

    const { data: reservations } = await bossaOwner.from("reservations").select("id").eq("lead_id", lead.id);
    expect(reservations).toHaveLength(1);
  });
});
