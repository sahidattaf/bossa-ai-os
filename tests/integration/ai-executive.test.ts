import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { executeAiRecommendation } from "@/lib/ai/action-router";
import { approveRecommendation, rejectRecommendation } from "@/lib/ai/approvals";
import { evaluateOrganization } from "@/lib/ai/evaluate";
import { getRecommendationDetail, listPendingApprovals, listRecommendations } from "@/lib/ai/recommendations";
import { isOperationalError } from "@/lib/errors";
import { createLead } from "@/lib/operations/leads";
import type { Database, Json } from "@/lib/supabase/database.types";

/**
 * Runs against a real local Supabase instance seeded from supabase/seed.sql
 * — see tests/integration/tenancy.test.ts for the same convention. Unlike
 * the pgTAP suite (which rolls back its whole transaction), every mutation
 * here persists for the rest of this file, so tests that approve/execute
 * use freshly created, uniquely dedupe-keyed fixtures rather than mutating
 * the shared seeded rows other tests might also read.
 */
const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

const DEV_PASSWORD = "DevPassword123!";
const BOSSA_ORG_ID = "00000000-0000-0000-0000-000000000001";
const PAPAI_ORG_ID = "00000000-0000-0000-0000-000000000002";
const BOSSA_OWNER_ID = "00000000-0000-0000-0002-000000000001";

async function signInAs(email: string): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { error } = await client.auth.signInWithPassword({ email, password: DEV_PASSWORD });
  if (error) throw new Error(`Failed to sign in as ${email}: ${error.message}`);
  return client;
}

async function applyTestIntent(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  dedupeKey: string,
  actionType: "assign_lead_owner" | "change_lead_status",
  payload: Record<string, unknown>,
) {
  const { error } = await supabase.rpc("apply_ai_evaluation", {
    p_organization_id: organizationId,
    // p_location_id has no SQL default, so the generated type is a required
    // (non-nullable) string even though a real null is valid and sent here.
    p_location_id: null as unknown as string,
    p_as_of: new Date().toISOString(),
    p_rule_version: `integration-test.${Date.now()}`,
    p_intents: {
      signals: [],
      recommendations: [
        {
          dedupe_key: dedupeKey,
          recommendation_type: "integration_test",
          title: "Integration test recommendation",
          executive_summary: "Created directly by an integration test.",
          severity: "info",
          recommended_action_type: actionType,
          recommended_action_payload: payload,
          rule_id: "integration-test.v1",
          requires_approval: true,
          evidence: [],
        },
      ],
    } as unknown as Json,
  });
  if (error) throw new Error(`applyTestIntent failed: ${error.message}`);
}

describe("AI Executive (Phase 4A)", () => {
  let bossaOwner: SupabaseClient<Database>;
  let bossaStaff: SupabaseClient<Database>;
  let papaiOwner: SupabaseClient<Database>;

  beforeAll(async () => {
    [bossaOwner, bossaStaff, papaiOwner] = await Promise.all([
      signInAs("owner@bossa.test"),
      signInAs("staff@bossa.test"),
      signInAs("owner@papai.test"),
    ]);
  });

  afterAll(async () => {
    await Promise.all([bossaOwner.auth.signOut(), bossaStaff.auth.signOut(), papaiOwner.auth.signOut()]);
  });

  it("deterministic evaluation generates isolated recommendations for BOSSA and Papai from the seeded fixtures", async () => {
    const asOf = new Date("2026-07-20T12:00:00Z");

    await evaluateOrganization(bossaOwner, BOSSA_ORG_ID, { asOf });
    await evaluateOrganization(papaiOwner, PAPAI_ORG_ID, { asOf });

    const [bossaRecs, papaiRecs] = await Promise.all([
      listRecommendations(bossaOwner, BOSSA_ORG_ID),
      listRecommendations(papaiOwner, PAPAI_ORG_ID),
    ]);

    expect(bossaRecs.length).toBeGreaterThan(0);
    expect(papaiRecs.length).toBeGreaterThan(0);
    expect(bossaRecs.every((r) => r.organization_id === BOSSA_ORG_ID)).toBe(true);
  });

  it("keeps BOSSA and Papai AI Executive datasets isolated when switching tenants", async () => {
    const bossaAsPapaiOwner = await listRecommendations(papaiOwner, BOSSA_ORG_ID);
    expect(bossaAsPapaiOwner).toEqual([]);
  });

  it("evidence links to the correct source record", async () => {
    const recs = await listRecommendations(bossaOwner, BOSSA_ORG_ID);
    const withLeadEvidence = recs.find((r) => r.recommendation_type === "unanswered_lead_followup");
    expect(withLeadEvidence).toBeDefined();

    const detail = await getRecommendationDetail(bossaOwner, BOSSA_ORG_ID, withLeadEvidence!.id);
    expect(detail?.evidence.length).toBeGreaterThan(0);
    const leadEvidence = detail?.evidence.find((e) => e.source_entity_type === "lead");
    expect(leadEvidence?.source_entity_id).toBe("00000000-0000-0000-0004-000000000001");
  });

  it("approves and executes a recommendation through the existing operational service, retaining the real domain effect", async () => {
    const lead = await createLead(bossaOwner, BOSSA_ORG_ID, {
      leadType: "general",
      source: "phone",
      contactName: "Integration Test Assignee Target",
      phone: `+599900${Date.now() % 100000}`,
    });

    const dedupeKey = `assign_owner_test:${Date.now()}`;
    await applyTestIntent(bossaOwner, BOSSA_ORG_ID, dedupeKey, "assign_lead_owner", {
      leadId: lead.id,
      ownerUserId: BOSSA_OWNER_ID,
    });

    const pending = await listPendingApprovals(bossaOwner, BOSSA_ORG_ID);
    const target = pending.find((p) => p.recommendation.dedupe_key === dedupeKey);
    expect(target).toBeDefined();

    const approval = await approveRecommendation(bossaOwner, target!.approval.id, target!.approval.version);
    expect(approval.status).toBe("approved");

    const execution = await executeAiRecommendation(bossaOwner, approval.recommendation_id);
    expect(execution.status).toBe("succeeded");

    const { data: updatedLead } = await bossaOwner.from("leads").select("owner_user_id").eq("id", lead.id).single();
    expect(updatedLead?.owner_user_id).toBe(BOSSA_OWNER_ID);
  });

  it("rejects a duplicate approval attempt with the stale version (optimistic concurrency)", async () => {
    const lead = await createLead(bossaOwner, BOSSA_ORG_ID, {
      leadType: "general",
      source: "phone",
      contactName: "Integration Test Duplicate Approval",
      phone: `+599901${Date.now() % 100000}`,
    });

    const dedupeKey = `duplicate_approval_test:${Date.now()}`;
    await applyTestIntent(bossaOwner, BOSSA_ORG_ID, dedupeKey, "assign_lead_owner", {
      leadId: lead.id,
      ownerUserId: BOSSA_OWNER_ID,
    });

    const pending = await listPendingApprovals(bossaOwner, BOSSA_ORG_ID);
    const target = pending.find((p) => p.recommendation.dedupe_key === dedupeKey)!;

    await approveRecommendation(bossaOwner, target.approval.id, target.approval.version);

    await expect(
      approveRecommendation(bossaOwner, target.approval.id, target.approval.version),
    ).rejects.toSatisfy((error: unknown) => isOperationalError(error));
  });

  it("refuses execution when the payload changed after approval (tamper/staleness detection)", async () => {
    const lead = await createLead(bossaOwner, BOSSA_ORG_ID, {
      leadType: "general",
      source: "phone",
      contactName: "Integration Test Tamper Detection",
      phone: `+599902${Date.now() % 100000}`,
    });

    const dedupeKey = `tamper_test:${Date.now()}`;
    await applyTestIntent(bossaOwner, BOSSA_ORG_ID, dedupeKey, "assign_lead_owner", {
      leadId: lead.id,
      ownerUserId: BOSSA_OWNER_ID,
    });

    const pending = await listPendingApprovals(bossaOwner, BOSSA_ORG_ID);
    const target = pending.find((p) => p.recommendation.dedupe_key === dedupeKey)!;
    await approveRecommendation(bossaOwner, target.approval.id, target.approval.version);

    // Re-evaluating with a different payload for the same dedupe_key
    // reopens the (now materially different) recommendation for a fresh
    // decision — see supabase/migrations/20260723000009_apply_ai_evaluation.sql.
    await applyTestIntent(bossaOwner, BOSSA_ORG_ID, dedupeKey, "assign_lead_owner", {
      leadId: lead.id,
      ownerUserId: "00000000-0000-0000-0002-000000000002",
    });

    await expect(executeAiRecommendation(bossaOwner, target.recommendation.id)).rejects.toSatisfy(
      (error: unknown) => isOperationalError(error) && error.code === "CONFLICT",
    );
  });

  it("records an honest failure outcome when the underlying domain action itself is rejected", async () => {
    const lead = await createLead(bossaOwner, BOSSA_ORG_ID, {
      leadType: "general",
      source: "phone",
      contactName: "Integration Test Failure Outcome",
      phone: `+599903${Date.now() % 100000}`,
    });

    const dedupeKey = `failure_test:${Date.now()}`;
    // "converted" is not a legal transition from a brand-new lead's "new"
    // status (only new -> contacted|lost are) — the domain's own
    // status-transition trigger will reject this at execution time.
    await applyTestIntent(bossaOwner, BOSSA_ORG_ID, dedupeKey, "change_lead_status", {
      leadId: lead.id,
      status: "converted",
    });

    const pending = await listPendingApprovals(bossaOwner, BOSSA_ORG_ID);
    const target = pending.find((p) => p.recommendation.dedupe_key === dedupeKey)!;
    await approveRecommendation(bossaOwner, target.approval.id, target.approval.version);

    const execution = await executeAiRecommendation(bossaOwner, target.recommendation.id);
    expect(execution.status).toBe("failed");
    expect(execution.error?.code).toBe("INVALID_STATUS_TRANSITION");

    const { data: attempts } = await bossaOwner
      .from("ai_action_attempts")
      .select("result_status, error_code")
      .eq("recommendation_id", target.recommendation.id);
    expect(attempts).toHaveLength(1);
    expect(attempts?.[0]?.result_status).toBe("failed");
  });

  it("rejects an unauthorized approval attempt without executing anything", async () => {
    const lead = await createLead(bossaOwner, BOSSA_ORG_ID, {
      leadType: "general",
      source: "phone",
      contactName: "Integration Test Unauthorized",
      phone: `+599904${Date.now() % 100000}`,
    });

    const dedupeKey = `unauthorized_test:${Date.now()}`;
    await applyTestIntent(bossaOwner, BOSSA_ORG_ID, dedupeKey, "assign_lead_owner", {
      leadId: lead.id,
      ownerUserId: BOSSA_OWNER_ID,
    });

    const pending = await listPendingApprovals(bossaOwner, BOSSA_ORG_ID);
    const target = pending.find((p) => p.recommendation.dedupe_key === dedupeKey)!;

    await expect(
      approveRecommendation(bossaStaff, target.approval.id, target.approval.version),
    ).rejects.toSatisfy((error: unknown) => isOperationalError(error) && error.code === "PERMISSION_DENIED");

    const { data: stillNew } = await bossaOwner.from("leads").select("owner_user_id").eq("id", lead.id).single();
    expect(stillNew?.owner_user_id).toBeNull();
  });

  it("surfaces a failed evaluation as a typed operational error and fabricates nothing", async () => {
    const before = await listRecommendations(bossaOwner, BOSSA_ORG_ID);

    // bossaStaff can gather facts (ai.executive.read) but apply_ai_evaluation
    // itself requires ai.recommendations.manage, which staff lacks — the
    // failure must surface as a typed error, not a partially-applied or
    // fabricated recommendation set.
    await expect(evaluateOrganization(bossaStaff, BOSSA_ORG_ID)).rejects.toSatisfy(
      (error: unknown) => isOperationalError(error) && error.code === "PERMISSION_DENIED",
    );

    const after = await listRecommendations(bossaOwner, BOSSA_ORG_ID);
    expect(after).toHaveLength(before.length);
  });

  it("rejects a recommendation with a reason and never executes it", async () => {
    const lead = await createLead(bossaOwner, BOSSA_ORG_ID, {
      leadType: "general",
      source: "phone",
      contactName: "Integration Test Reject Flow",
      phone: `+599905${Date.now() % 100000}`,
    });

    const dedupeKey = `reject_test:${Date.now()}`;
    await applyTestIntent(bossaOwner, BOSSA_ORG_ID, dedupeKey, "assign_lead_owner", {
      leadId: lead.id,
      ownerUserId: BOSSA_OWNER_ID,
    });

    const pending = await listPendingApprovals(bossaOwner, BOSSA_ORG_ID);
    const target = pending.find((p) => p.recommendation.dedupe_key === dedupeKey)!;

    const rejected = await rejectRecommendation(bossaOwner, target.approval.id, target.approval.version, "Not needed");
    expect(rejected.status).toBe("rejected");

    await expect(executeAiRecommendation(bossaOwner, target.recommendation.id)).rejects.toSatisfy(
      (error: unknown) => isOperationalError(error),
    );
  });
});
