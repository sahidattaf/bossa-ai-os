"use server";

import { revalidatePath } from "next/cache";

import { getDashboardProviderMode } from "@/lib/dashboard/get-data-provider";
import { isOperationalError } from "@/lib/errors";
import { createReservation, updateReservationStatus } from "@/lib/operations";
import { createClient } from "@/lib/supabase/server";
import { resolveTenantForCurrentUser } from "@/lib/tenancy/supabase-tenants";

export interface ReservationActionState {
  error?: string;
}

const initialState: ReservationActionState = {};

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

export async function createReservationAction(
  _prevState: ReservationActionState,
  formData: FormData,
): Promise<ReservationActionState> {
  try {
    const organizationSlug = String(formData.get("organizationSlug") ?? "");
    const organizationId = await resolveOrganizationId(organizationSlug);
    const supabase = await createClient();

    const reservationDate = String(formData.get("reservationDate") ?? "");
    const reservationTime = String(formData.get("reservationTime") ?? "");

    await createReservation(supabase, organizationId, {
      locationId: formData.get("locationId"),
      guestName: formData.get("guestName"),
      phone: formData.get("phone"),
      email: formData.get("email") || null,
      partySize: Number(formData.get("partySize")),
      reservationAt: reservationDate && reservationTime ? new Date(`${reservationDate}T${reservationTime}:00Z`).toISOString() : undefined,
      source: formData.get("source"),
      notes: formData.get("notes") || null,
    });

    revalidatePath(`/${organizationSlug}/reservations`);
    return initialState;
  } catch (error) {
    if (isOperationalError(error)) {
      return { error: error.message };
    }
    return { error: error instanceof Error ? error.message : "Something went wrong." };
  }
}

export async function updateReservationStatusAction(
  _prevState: ReservationActionState,
  formData: FormData,
): Promise<ReservationActionState> {
  try {
    const organizationSlug = String(formData.get("organizationSlug") ?? "");
    const reservationId = String(formData.get("reservationId") ?? "");
    const status = formData.get("status");

    const organizationId = await resolveOrganizationId(organizationSlug);
    const supabase = await createClient();

    await updateReservationStatus(supabase, organizationId, reservationId, status);

    revalidatePath(`/${organizationSlug}/reservations`);
    return initialState;
  } catch (error) {
    if (isOperationalError(error)) {
      return { error: error.message };
    }
    return { error: error instanceof Error ? error.message : "Something went wrong." };
  }
}
