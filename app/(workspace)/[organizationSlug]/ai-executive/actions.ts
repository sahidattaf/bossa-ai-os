"use server";

import { revalidatePath } from "next/cache";

import { approveAndExecuteRecommendation, dismissRecommendation, rejectRecommendation } from "@/lib/ai/approvals";
import { getDashboardProviderMode } from "@/lib/dashboard/get-data-provider";
import { isOperationalError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

export interface AiActionState {
  error?: string;
}

const initialState: AiActionState = {};

function ensureSupabaseMode(): void {
  if (getDashboardProviderMode() === "mock") {
    throw new Error("Mock mode is read-only — approvals are not available.");
  }
}

function revalidateAiRoutes(organizationSlug: string): void {
  revalidatePath(`/${organizationSlug}/ai-executive`);
  revalidatePath(`/${organizationSlug}/ai-executive/approvals`);
  revalidatePath(`/${organizationSlug}/dashboard`);
}

/**
 * The UI's single "Approve & Execute" button — underneath, approveRecommendation()
 * and the action router's execution are still two separate, durable RPC
 * calls (see lib/ai/approvals.ts). A failed execution does not undo the
 * approval; it's reported here as a partial-success message so the reviewer
 * knows the decision stuck even though the action itself needs a retry.
 */
export async function approveAndExecuteAction(_prevState: AiActionState, formData: FormData): Promise<AiActionState> {
  try {
    ensureSupabaseMode();
    const organizationSlug = String(formData.get("organizationSlug") ?? "");
    const approvalId = String(formData.get("approvalId") ?? "");
    const expectedVersion = Number(formData.get("expectedVersion"));
    const supabase = await createClient();

    const result = await approveAndExecuteRecommendation(supabase, approvalId, expectedVersion);

    revalidateAiRoutes(organizationSlug);

    if (result.execution.status === "failed") {
      return { error: `Approved, but execution failed: ${result.execution.error?.message ?? "Unknown error"}. It can be retried.` };
    }

    return initialState;
  } catch (error) {
    if (isOperationalError(error)) return { error: error.message };
    return { error: error instanceof Error ? error.message : "Something went wrong." };
  }
}

export async function rejectRecommendationAction(_prevState: AiActionState, formData: FormData): Promise<AiActionState> {
  try {
    ensureSupabaseMode();
    const organizationSlug = String(formData.get("organizationSlug") ?? "");
    const approvalId = String(formData.get("approvalId") ?? "");
    const expectedVersion = Number(formData.get("expectedVersion"));
    const reason = String(formData.get("reason") ?? "");
    const supabase = await createClient();

    await rejectRecommendation(supabase, approvalId, expectedVersion, reason);

    revalidateAiRoutes(organizationSlug);
    return initialState;
  } catch (error) {
    if (isOperationalError(error)) return { error: error.message };
    return { error: error instanceof Error ? error.message : "Something went wrong." };
  }
}

export async function dismissRecommendationAction(_prevState: AiActionState, formData: FormData): Promise<AiActionState> {
  try {
    ensureSupabaseMode();
    const organizationSlug = String(formData.get("organizationSlug") ?? "");
    const recommendationId = String(formData.get("recommendationId") ?? "");
    const supabase = await createClient();

    await dismissRecommendation(supabase, recommendationId);

    revalidateAiRoutes(organizationSlug);
    return initialState;
  } catch (error) {
    if (isOperationalError(error)) return { error: error.message };
    return { error: error instanceof Error ? error.message : "Something went wrong." };
  }
}
