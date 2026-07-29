import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { isOperationalError } from "@/lib/errors";
import { createLead, updateLeadStatus } from "@/lib/operations/leads";
import { generateDailyKpiSnapshot } from "@/lib/operations/kpi-snapshots";
import { createOrder } from "@/lib/operations/orders";
import { listReservations } from "@/lib/operations/reservations";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Runs against a real local Supabase instance seeded from supabase/seed.sql
 * — see tests/integration/tenancy.test.ts for the same convention. Only
 * invoked via `npm run test:integration` in CI's `database` job, after
 * `supabase db reset`.
 */
const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

const DEV_PASSWORD = "DevPassword123!";

const BOSSA_ORG_ID = "00000000-0000-0000-0000-000000000001";
const PAPAI_ORG_ID = "00000000-0000-0000-0000-000000000002";
const BOSSA_LOCATION_ID = "00000000-0000-0000-0001-000000000001";

async function signInAs(email: string): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { error } = await client.auth.signInWithPassword({ email, password: DEV_PASSWORD });
  if (error) {
    throw new Error(`Failed to sign in as ${email}: ${error.message}`);
  }
  return client;
}

describe("operational data (Phase 3A)", () => {
  let bossaOwner: SupabaseClient<Database>;
  let bossaStaff: SupabaseClient<Database>;
  let papaiOwner: SupabaseClient<Database>;
  let outsider: SupabaseClient<Database>;

  beforeAll(async () => {
    [bossaOwner, bossaStaff, papaiOwner, outsider] = await Promise.all([
      signInAs("owner@bossa.test"),
      signInAs("staff@bossa.test"),
      signInAs("owner@papai.test"),
      signInAs("outsider@example.test"),
    ]);
  });

  afterAll(async () => {
    await Promise.all([
      bossaOwner.auth.signOut(),
      bossaStaff.auth.signOut(),
      papaiOwner.auth.signOut(),
      outsider.auth.signOut(),
    ]);
  });

  it("scopes reservations to the caller's own organization and changes with tenant switch", async () => {
    const bossaReservations = await listReservations(bossaOwner, BOSSA_ORG_ID);
    const papaiReservations = await listReservations(papaiOwner, PAPAI_ORG_ID);

    expect(bossaReservations.length).toBeGreaterThan(0);
    expect(papaiReservations.length).toBeGreaterThan(0);
    expect(bossaReservations.every((r) => r.organization_id === BOSSA_ORG_ID)).toBe(true);
    expect(papaiReservations.every((r) => r.organization_id === PAPAI_ORG_ID)).toBe(true);

    const bossaAsPapaiOwner = await listReservations(papaiOwner, BOSSA_ORG_ID);
    expect(bossaAsPapaiOwner).toEqual([]);
  });

  it("lets a permitted role (owner, crm.write) create a lead", async () => {
    const lead = await createLead(bossaOwner, BOSSA_ORG_ID, {
      leadType: "general",
      source: "phone",
      contactName: "Integration Test Lead",
      phone: "+5990000099",
    });

    expect(lead.organization_id).toBe(BOSSA_ORG_ID);
    expect(lead.status).toBe("new");
  });

  it("surfaces PERMISSION_DENIED as a typed OperationalError for a forbidden role (staff, no crm.write)", async () => {
    await expect(
      createLead(bossaStaff, BOSSA_ORG_ID, {
        leadType: "general",
        source: "phone",
        contactName: "Should Not Be Created",
        phone: "+5990000000",
      }),
    ).rejects.toSatisfy((error: unknown) => isOperationalError(error) && error.code === "PERMISSION_DENIED");
  });

  it("surfaces INVALID_STATUS_TRANSITION as a typed OperationalError for an illegal lead status change", async () => {
    const lead = await createLead(bossaOwner, BOSSA_ORG_ID, {
      leadType: "general",
      source: "phone",
      contactName: "Transition Test Lead",
      phone: "+5990000098",
    });

    // new -> converted is not a registered transition (must pass through
    // contacted or qualified first).
    await expect(
      updateLeadStatus(bossaOwner, BOSSA_ORG_ID, lead.id, "converted"),
    ).rejects.toSatisfy((error: unknown) => isOperationalError(error) && error.code === "INVALID_STATUS_TRANSITION");
  });

  it("computes order totals from order_items server-side, never from client input", async () => {
    const { order, items } = await createOrder(bossaOwner, BOSSA_ORG_ID, {
      locationId: BOSSA_LOCATION_ID,
      orderNumber: `INTEGRATION-${Date.now()}`,
      channel: "dine_in",
      fulfillmentType: "dine_in",
      customerName: "Integration Test Order",
      taxTotal: 2,
      items: [
        { itemName: "Test Item A", quantity: 2, unitPrice: 10 },
        { itemName: "Test Item B", quantity: 1, unitPrice: 5 },
      ],
    });

    expect(items).toHaveLength(2);
    expect(order.subtotal).toBe(25);
    expect(order.total).toBe(27);
  });

  it("keeps calculate_daily_kpi_snapshot idempotent when called twice", async () => {
    const first = await generateDailyKpiSnapshot(bossaOwner, BOSSA_ORG_ID, { date: new Date("2026-07-20T12:00:00Z") });
    const second = await generateDailyKpiSnapshot(bossaOwner, BOSSA_ORG_ID, { date: new Date("2026-07-20T12:00:00Z") });

    expect(second.id).toBe(first.id);
    expect(second.revenue).toBe(first.revenue);
  });

  it("gates revenue fields in get_dashboard_snapshot behind finance.read, without denying the whole call", async () => {
    const { data: ownerSnapshot, error: ownerError } = await bossaOwner.rpc("get_dashboard_snapshot", {
      p_organization_id: BOSSA_ORG_ID,
      p_as_of: "2026-07-20T18:00:00Z",
    });
    expect(ownerError).toBeNull();
    expect((ownerSnapshot as Record<string, unknown>).revenue_today).not.toBeNull();

    const { data: staffSnapshot, error: staffError } = await bossaStaff.rpc("get_dashboard_snapshot", {
      p_organization_id: BOSSA_ORG_ID,
      p_as_of: "2026-07-20T18:00:00Z",
    });
    expect(staffError).toBeNull();
    expect((staffSnapshot as Record<string, unknown>).revenue_today).toBeNull();
    expect((staffSnapshot as Record<string, unknown>).orders_today).toEqual(
      (ownerSnapshot as Record<string, unknown>).orders_today,
    );
    expect((staffSnapshot as Record<string, unknown>).active_orders).toEqual(
      (ownerSnapshot as Record<string, unknown>).active_orders,
    );
  });

  it("reports active orders separately from orders created today", async () => {
    const { data: snapshot, error } = await bossaOwner.rpc("get_dashboard_snapshot", {
      p_organization_id: BOSSA_ORG_ID,
      p_as_of: "2026-07-20T18:00:00Z",
    });

    expect(error).toBeNull();
    expect((snapshot as Record<string, unknown>).orders_today).toBe(2);
    expect((snapshot as Record<string, unknown>).active_orders).toBe(1);
  });

  it("rejects get_dashboard_snapshot for a user with no membership in the organization at all", async () => {
    const { error } = await outsider.rpc("get_dashboard_snapshot", {
      p_organization_id: BOSSA_ORG_ID,
    });

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/^PERMISSION_DENIED:/);
  });
});
