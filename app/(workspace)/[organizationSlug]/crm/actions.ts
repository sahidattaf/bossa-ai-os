"use server";

import { revalidatePath } from "next/cache";

import { isOperationalError } from "@/lib/errors";
import { getDashboardProviderMode } from "@/lib/dashboard/get-data-provider";
import { createLead, updateLeadStatus } from "@/lib/operations";
import { createClient } from "@/lib/supabase/server";
import { resolveTenantForCurrentUser } from "@/lib/tenancy/supabase-tenants";

export interface LeadActionState {
  error?: string;
}

const initialState: LeadActionState = {};

async function resolveOrganizationId(organizationSlug: string): Promise<string> {
  if (getDashboardProviderMode() === "mock") {
    throw new Error("Mock mode is read-only — mutations are not available.");
  }

  const supabase = await createClient();
  const access = await resolveTenantForCurrentUser(supabase, organizationSlug);
  if (access.status !== "ok") {
    throw new Error("You don't have access to this organization.");
  }
  return access.tenant.id;
}

export async function createLeadAction(
  _prevState: LeadActionState,
  formData: FormData,
): Promise<LeadActionState> {
  try {
    const organizationSlug = String(formData.get("organizationSlug") ?? "");
    const organizationId = await resolveOrganizationId(organizationSlug);
    const supabase = await createClient();

    const guestCountRaw = formData.get("guestCount");

    await createLead(supabase, organizationId, {
      leadType: formData.get("leadType"),
      source: formData.get("source"),
      contactName: formData.get("contactName"),
      phone: formData.get("phone"),
      email: formData.get("email") || null,
      guestCount: guestCountRaw ? Number(guestCountRaw) : null,
      message: formData.get("message") || null,
    });

    revalidatePath(`/${organizationSlug}/crm`);
    return initialState;
  } catch (error) {
    if (isOperationalError(error)) {
      return { error: error.message };
    }
    return { error: error instanceof Error ? error.message : "Something went wrong." };
  }
}

export async function updateLeadStatusAction(
  _prevState: LeadActionState,
  formData: FormData,
): Promise<LeadActionState> {
  try {
    const organizationSlug = String(formData.get("organizationSlug") ?? "");
    const leadId = String(formData.get("leadId") ?? "");
    const status = formData.get("status");

    const organizationId = await resolveOrganizationId(organizationSlug);
    const supabase = await createClient();

    await updateLeadStatus(supabase, organizationId, leadId, status);

    revalidatePath(`/${organizationSlug}/crm`);
    return initialState;
  } catch (error) {
    if (isOperationalError(error)) {
      return { error: error.message };
    }
    return { error: error instanceof Error ? error.message : "Something went wrong." };
  }
}
