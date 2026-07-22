"use server";

import { revalidatePath } from "next/cache";

import { getDashboardProviderMode } from "@/lib/dashboard/get-data-provider";
import { isOperationalError } from "@/lib/errors";
import {
  addOrderItem,
  createOrder,
  removeOrderItem,
  updateOrderPaymentStatus,
  updateOrderStatus,
} from "@/lib/operations";
import { createClient } from "@/lib/supabase/server";
import { resolveTenantForCurrentUser } from "@/lib/tenancy/supabase-tenants";

export interface OrderActionState {
  error?: string;
}

const initialState: OrderActionState = {};

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

interface RawItemInput {
  itemName: string;
  quantity: number;
  unitPrice: number;
}

export async function createOrderAction(
  _prevState: OrderActionState,
  formData: FormData,
): Promise<OrderActionState> {
  try {
    const organizationSlug = String(formData.get("organizationSlug") ?? "");
    const organizationId = await resolveOrganizationId(organizationSlug);
    const supabase = await createClient();

    const itemsRaw = String(formData.get("items") ?? "[]");
    let items: RawItemInput[];
    try {
      items = JSON.parse(itemsRaw);
    } catch {
      return { error: "Order items were malformed. Add at least one item." };
    }

    const order = await createOrder(supabase, organizationId, {
      locationId: formData.get("locationId"),
      orderNumber: formData.get("orderNumber"),
      channel: formData.get("channel"),
      fulfillmentType: formData.get("fulfillmentType"),
      customerName: formData.get("customerName"),
      phone: formData.get("phone") || null,
      items: items.map((item) => ({
        itemName: item.itemName,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
      })),
    });

    revalidatePath(`/${organizationSlug}/orders`);
    revalidatePath(`/${organizationSlug}/orders/${order.order.id}`);
    return initialState;
  } catch (error) {
    if (isOperationalError(error)) {
      return { error: error.message };
    }
    return { error: error instanceof Error ? error.message : "Something went wrong." };
  }
}

export async function updateOrderStatusAction(
  _prevState: OrderActionState,
  formData: FormData,
): Promise<OrderActionState> {
  try {
    const organizationSlug = String(formData.get("organizationSlug") ?? "");
    const orderId = String(formData.get("orderId") ?? "");
    const status = formData.get("status");

    const organizationId = await resolveOrganizationId(organizationSlug);
    const supabase = await createClient();

    await updateOrderStatus(supabase, organizationId, orderId, status);

    revalidatePath(`/${organizationSlug}/orders`);
    revalidatePath(`/${organizationSlug}/orders/${orderId}`);
    return initialState;
  } catch (error) {
    if (isOperationalError(error)) {
      return { error: error.message };
    }
    return { error: error instanceof Error ? error.message : "Something went wrong." };
  }
}

export async function updateOrderPaymentStatusAction(
  _prevState: OrderActionState,
  formData: FormData,
): Promise<OrderActionState> {
  try {
    const organizationSlug = String(formData.get("organizationSlug") ?? "");
    const orderId = String(formData.get("orderId") ?? "");
    const paymentStatus = formData.get("paymentStatus");

    const organizationId = await resolveOrganizationId(organizationSlug);
    const supabase = await createClient();

    await updateOrderPaymentStatus(supabase, organizationId, orderId, paymentStatus);

    revalidatePath(`/${organizationSlug}/orders`);
    revalidatePath(`/${organizationSlug}/orders/${orderId}`);
    return initialState;
  } catch (error) {
    if (isOperationalError(error)) {
      return { error: error.message };
    }
    return { error: error instanceof Error ? error.message : "Something went wrong." };
  }
}

export async function addOrderItemAction(
  _prevState: OrderActionState,
  formData: FormData,
): Promise<OrderActionState> {
  try {
    const organizationSlug = String(formData.get("organizationSlug") ?? "");
    const orderId = String(formData.get("orderId") ?? "");

    const organizationId = await resolveOrganizationId(organizationSlug);
    const supabase = await createClient();

    await addOrderItem(supabase, organizationId, orderId, {
      itemName: formData.get("itemName"),
      quantity: Number(formData.get("quantity")),
      unitPrice: Number(formData.get("unitPrice")),
    });

    revalidatePath(`/${organizationSlug}/orders/${orderId}`);
    return initialState;
  } catch (error) {
    if (isOperationalError(error)) {
      return { error: error.message };
    }
    return { error: error instanceof Error ? error.message : "Something went wrong." };
  }
}

export async function removeOrderItemAction(
  _prevState: OrderActionState,
  formData: FormData,
): Promise<OrderActionState> {
  try {
    const organizationSlug = String(formData.get("organizationSlug") ?? "");
    const orderId = String(formData.get("orderId") ?? "");
    const orderItemId = String(formData.get("orderItemId") ?? "");

    const organizationId = await resolveOrganizationId(organizationSlug);
    const supabase = await createClient();

    await removeOrderItem(supabase, organizationId, orderId, orderItemId);

    revalidatePath(`/${organizationSlug}/orders/${orderId}`);
    return initialState;
  } catch (error) {
    if (isOperationalError(error)) {
      return { error: error.message };
    }
    return { error: error instanceof Error ? error.message : "Something went wrong." };
  }
}
