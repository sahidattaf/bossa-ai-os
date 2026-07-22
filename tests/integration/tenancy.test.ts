import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/lib/supabase/database.types";

/**
 * Runs against a real local Supabase instance (`supabase start` + `supabase
 * db reset`, seeded from supabase/seed.sql) — never against mocks. Only
 * invoked via `npm run test:integration` in CI's `database` job.
 */
const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  // Standard, publicly-documented local Supabase CLI demo anon key — not a secret.
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

const DEV_PASSWORD = "DevPassword123!";

const BOSSA_ORG_ID = "00000000-0000-0000-0000-000000000001";
const PAPAI_ORG_ID = "00000000-0000-0000-0000-000000000002";

async function signInAs(email: string): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { error } = await client.auth.signInWithPassword({ email, password: DEV_PASSWORD });
  if (error) {
    throw new Error(`Failed to sign in as ${email}: ${error.message}`);
  }
  return client;
}

describe("membership-based tenant access", () => {
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

  it("lets an authenticated member access their own organization", async () => {
    const { data, error } = await bossaOwner
      .from("organizations")
      .select("id, slug, name")
      .eq("id", BOSSA_ORG_ID)
      .maybeSingle();

    expect(error).toBeNull();
    expect(data?.slug).toBe("bossa");
  });

  it("does not let a member access another organization by UUID", async () => {
    const { data, error } = await bossaOwner
      .from("organizations")
      .select("id")
      .eq("id", PAPAI_ORG_ID)
      .maybeSingle();

    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it("does not let a member access another organization by slug", async () => {
    const { data } = await bossaOwner.from("organizations").select("id").eq("slug", "papai").maybeSingle();
    expect(data).toBeNull();
  });

  it("returns not-found for a truly unknown organization slug", async () => {
    const { data } = await bossaOwner.rpc("get_organization_summary", { p_slug: "does-not-exist" });
    expect(data ?? []).toHaveLength(0);
  });

  it("distinguishes a known-but-inaccessible organization from an unknown one", async () => {
    const { data: summary } = await outsider.rpc("get_organization_summary", { p_slug: "bossa" });
    expect(summary).toHaveLength(1);

    const { data: fullRow } = await outsider
      .from("organizations")
      .select("id")
      .eq("slug", "bossa")
      .maybeSingle();
    expect(fullRow).toBeNull();
  });

  it("derives BOSSA owner permissions from the database role catalog", async () => {
    const { data } = await bossaOwner.rpc("get_my_permissions", { p_organization_id: BOSSA_ORG_ID });
    expect(data).toEqual(expect.arrayContaining(["dashboard.read", "settings.write", "organization.manage"]));
  });

  it("derives BOSSA staff permissions as a strict subset of the owner's", async () => {
    const { data } = await bossaStaff.rpc("get_my_permissions", { p_organization_id: BOSSA_ORG_ID });
    expect(data).toEqual(expect.arrayContaining(["dashboard.read", "orders.read"]));
    expect(data).not.toContain("settings.write");
    expect(data).not.toContain("organization.manage");
  });

  it("gives a user with zero memberships an empty permission set, not a default grant", async () => {
    const { data } = await outsider.rpc("get_my_permissions", { p_organization_id: BOSSA_ORG_ID });
    expect(data).toEqual([]);
  });

  it("keeps BOSSA and Papai branding/settings isolated per member", async () => {
    const [{ data: bossaSettings }, { data: papaiSettingsAsBossaOwner }] = await Promise.all([
      bossaOwner.from("organization_settings").select("ai_manager_name").eq("organization_id", BOSSA_ORG_ID).maybeSingle(),
      bossaOwner.from("organization_settings").select("ai_manager_name").eq("organization_id", PAPAI_ORG_ID).maybeSingle(),
    ]);

    expect(bossaSettings?.ai_manager_name).toBe("BossVisionGPT");
    expect(papaiSettingsAsBossaOwner).toBeNull();

    const { data: papaiSettings } = await papaiOwner
      .from("organization_settings")
      .select("ai_manager_name")
      .eq("organization_id", PAPAI_ORG_ID)
      .maybeSingle();
    expect(papaiSettings?.ai_manager_name).toBe("PapaiLegacyGPT");
  });
});
