import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { toOperationalError } from "@/lib/errors";
import type { Database, Json } from "@/lib/supabase/database.types";

import {
  createOrderSchema,
  orderItemInputSchema,
  orderPaymentStatusSchema,
  orderStatusSchema,
  updateOrderItemSchema,
  updateOrderSchema,
} from "./schemas";
import { parseInput } from "./validate";

type Order = Database["public"]["Tables"]["orders"]["Row"];
type OrderItem = Database["public"]["Tables"]["order_items"]["Row"];
type SupabaseDb = SupabaseClient<Database>;

export interface OrderWithItems {
  order: Order;
  items: OrderItem[];
}

async function fetchOrder(supabase: SupabaseDb, organizationId: string, orderId: string): Promise<Order> {
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("id", orderId)
    .single();

  if (error) throw toOperationalError(error);
  return data;
}

export async function listOrders(
  supabase: SupabaseDb,
  organizationId: string,
  options?: { status?: string },
): Promise<Order[]> {
  let query = supabase
    .from("orders")
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

export async function getOrderWithItems(
  supabase: SupabaseDb,
  organizationId: string,
  orderId: string,
): Promise<OrderWithItems | null> {
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("id", orderId)
    .maybeSingle();

  if (orderError) throw toOperationalError(orderError);
  if (!order) return null;

  const { data: items, error: itemsError } = await supabase
    .from("order_items")
    .select("*")
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });

  if (itemsError) throw toOperationalError(itemsError);

  return { order, items: items ?? [] };
}

/**
 * Creates the order row, then its items in a second round trip. Each item
 * insert fires public.recalculate_order_totals() (20260722000003), which
 * atomically recomputes subtotal/total for the order within that statement's
 * own transaction — so the final re-fetch below always reflects every item
 * that made it in, even in the (rare) case where a later item in the batch
 * fails. subtotal/total are never sent by this client — the database always
 * computes them (issue #16 rule 4).
 */
export async function createOrder(
  supabase: SupabaseDb,
  organizationId: string,
  input: unknown,
): Promise<OrderWithItems> {
  const parsed = parseInput(createOrderSchema, input);

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .insert({
      organization_id: organizationId,
      location_id: parsed.locationId,
      lead_id: parsed.leadId ?? null,
      reservation_id: parsed.reservationId ?? null,
      order_number: parsed.orderNumber,
      channel: parsed.channel,
      fulfillment_type: parsed.fulfillmentType,
      customer_name: parsed.customerName,
      phone: parsed.phone ?? null,
      discount_total: parsed.discountTotal ?? undefined,
      tax_total: parsed.taxTotal ?? undefined,
      delivery_fee: parsed.deliveryFee ?? undefined,
      currency: parsed.currency ?? undefined,
      requested_for: parsed.requestedFor ?? null,
      notes: parsed.notes ?? null,
    })
    .select("*")
    .single();

  if (orderError) throw toOperationalError(orderError);

  const { error: itemsError } = await supabase.from("order_items").insert(
    parsed.items.map((item) => ({
      organization_id: organizationId,
      order_id: order.id,
      item_name: item.itemName,
      item_sku: item.itemSku ?? null,
      quantity: item.quantity,
      unit_price: item.unitPrice,
      metadata: (item.metadata ?? {}) as Json,
    })),
  );

  if (itemsError) throw toOperationalError(itemsError);

  await supabase.rpc("record_audit_event", {
    p_organization_id: organizationId,
    p_action: "order.created",
    p_entity_type: "order",
    p_entity_id: order.id,
    p_metadata: { order_number: parsed.orderNumber, item_count: parsed.items.length },
  });

  const result = await getOrderWithItems(supabase, organizationId, order.id);
  if (!result) {
    throw toOperationalError({ code: undefined, message: `Order ${order.id} disappeared immediately after creation` });
  }
  return result;
}

export async function updateOrder(
  supabase: SupabaseDb,
  organizationId: string,
  orderId: string,
  input: unknown,
): Promise<Order> {
  const parsed = parseInput(updateOrderSchema, input);

  const patch: Database["public"]["Tables"]["orders"]["Update"] = {};
  if (parsed.locationId !== undefined) patch.location_id = parsed.locationId;
  if (parsed.leadId !== undefined) patch.lead_id = parsed.leadId;
  if (parsed.reservationId !== undefined) patch.reservation_id = parsed.reservationId;
  if (parsed.orderNumber !== undefined) patch.order_number = parsed.orderNumber;
  if (parsed.channel !== undefined) patch.channel = parsed.channel;
  if (parsed.fulfillmentType !== undefined) patch.fulfillment_type = parsed.fulfillmentType;
  if (parsed.customerName !== undefined) patch.customer_name = parsed.customerName;
  if (parsed.phone !== undefined) patch.phone = parsed.phone;
  if (parsed.discountTotal !== undefined) patch.discount_total = parsed.discountTotal;
  if (parsed.taxTotal !== undefined) patch.tax_total = parsed.taxTotal;
  if (parsed.deliveryFee !== undefined) patch.delivery_fee = parsed.deliveryFee;
  if (parsed.currency !== undefined) patch.currency = parsed.currency;
  if (parsed.requestedFor !== undefined) patch.requested_for = parsed.requestedFor;
  if (parsed.notes !== undefined) patch.notes = parsed.notes;
  // subtotal/total are never assigned from `parsed` here — updateOrderSchema
  // has no such fields at all, and the database would reject the column
  // even if it did (20260722000005 grants no UPDATE on them to authenticated).

  const { data, error } = await supabase
    .from("orders")
    .update(patch)
    .eq("organization_id", organizationId)
    .eq("id", orderId)
    .select("*")
    .single();

  if (error) throw toOperationalError(error);
  return data;
}

/** See lib/operations/leads.ts's updateLeadStatus for why this doesn't call record_audit_event() itself. */
export async function updateOrderStatus(
  supabase: SupabaseDb,
  organizationId: string,
  orderId: string,
  status: unknown,
): Promise<Order> {
  const parsedStatus = parseInput(orderStatusSchema, status);

  const { data, error } = await supabase
    .from("orders")
    .update({ status: parsedStatus })
    .eq("organization_id", organizationId)
    .eq("id", orderId)
    .select("*")
    .single();

  if (error) throw toOperationalError(error);
  return data;
}

/** See lib/operations/leads.ts's updateLeadStatus for why this doesn't call record_audit_event() itself. */
export async function updateOrderPaymentStatus(
  supabase: SupabaseDb,
  organizationId: string,
  orderId: string,
  paymentStatus: unknown,
): Promise<Order> {
  const parsedStatus = parseInput(orderPaymentStatusSchema, paymentStatus);

  const { data, error } = await supabase
    .from("orders")
    .update({ payment_status: parsedStatus })
    .eq("organization_id", organizationId)
    .eq("id", orderId)
    .select("*")
    .single();

  if (error) throw toOperationalError(error);
  return data;
}

export async function cancelOrder(supabase: SupabaseDb, organizationId: string, orderId: string): Promise<Order> {
  return updateOrderStatus(supabase, organizationId, orderId, "cancelled");
}

export async function addOrderItem(
  supabase: SupabaseDb,
  organizationId: string,
  orderId: string,
  input: unknown,
): Promise<OrderWithItems> {
  const parsed = parseInput(orderItemInputSchema, input);

  const { error } = await supabase.from("order_items").insert({
    organization_id: organizationId,
    order_id: orderId,
    item_name: parsed.itemName,
    item_sku: parsed.itemSku ?? null,
    quantity: parsed.quantity,
    unit_price: parsed.unitPrice,
    metadata: (parsed.metadata ?? {}) as Json,
  });

  if (error) throw toOperationalError(error);

  const result = await getOrderWithItems(supabase, organizationId, orderId);
  if (!result) throw toOperationalError({ message: `Order ${orderId} was not found` });
  return result;
}

export async function updateOrderItem(
  supabase: SupabaseDb,
  organizationId: string,
  orderId: string,
  orderItemId: string,
  input: unknown,
): Promise<OrderWithItems> {
  const parsed = parseInput(updateOrderItemSchema, input);

  const patch: Database["public"]["Tables"]["order_items"]["Update"] = {};
  if (parsed.itemName !== undefined) patch.item_name = parsed.itemName;
  if (parsed.itemSku !== undefined) patch.item_sku = parsed.itemSku;
  if (parsed.quantity !== undefined) patch.quantity = parsed.quantity;
  if (parsed.unitPrice !== undefined) patch.unit_price = parsed.unitPrice;
  if (parsed.metadata !== undefined) patch.metadata = parsed.metadata as Json;

  const { error } = await supabase
    .from("order_items")
    .update(patch)
    .eq("organization_id", organizationId)
    .eq("id", orderItemId)
    .eq("order_id", orderId);

  if (error) throw toOperationalError(error);

  const result = await getOrderWithItems(supabase, organizationId, orderId);
  if (!result) throw toOperationalError({ message: `Order ${orderId} was not found` });
  return result;
}

export async function removeOrderItem(
  supabase: SupabaseDb,
  organizationId: string,
  orderId: string,
  orderItemId: string,
): Promise<OrderWithItems> {
  const { error } = await supabase
    .from("order_items")
    .delete()
    .eq("organization_id", organizationId)
    .eq("id", orderItemId)
    .eq("order_id", orderId);

  if (error) throw toOperationalError(error);

  const result = await getOrderWithItems(supabase, organizationId, orderId);
  if (!result) throw toOperationalError({ message: `Order ${orderId} was not found` });
  return result;
}

export { fetchOrder as getOrder };
