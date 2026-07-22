import { z } from "zod";

import {
  LEAD_SOURCES,
  LEAD_STATUSES,
  LEAD_TYPES,
  ORDER_CHANNELS,
  ORDER_FULFILLMENT_TYPES,
  ORDER_PAYMENT_STATUSES,
  ORDER_STATUSES,
  RESERVATION_STATUSES,
} from "./status";

export const createLeadSchema = z.object({
  locationId: z.string().uuid().nullable().optional(),
  leadType: z.enum(LEAD_TYPES),
  source: z.enum(LEAD_SOURCES),
  contactName: z.string().trim().min(1).max(200),
  phone: z.string().trim().min(1).max(50),
  email: z.string().trim().email().nullable().optional(),
  guestCount: z.number().int().positive().nullable().optional(),
  requestedDate: z.string().datetime().nullable().optional(),
  budget: z.number().nonnegative().nullable().optional(),
  message: z.string().max(2000).nullable().optional(),
  ownerUserId: z.string().uuid().nullable().optional(),
});
export type CreateLeadInput = z.infer<typeof createLeadSchema>;

export const updateLeadSchema = createLeadSchema.partial();
export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;

export const leadStatusSchema = z.enum(LEAD_STATUSES);

export const createReservationSchema = z.object({
  locationId: z.string().uuid(),
  leadId: z.string().uuid().nullable().optional(),
  guestName: z.string().trim().min(1).max(200),
  phone: z.string().trim().min(1).max(50),
  email: z.string().trim().email().nullable().optional(),
  partySize: z.number().int().positive(),
  reservationAt: z.string().datetime(),
  durationMinutes: z.number().int().positive().optional(),
  occasion: z.string().max(200).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  source: z.enum(LEAD_SOURCES),
  assignedUserId: z.string().uuid().nullable().optional(),
});
export type CreateReservationInput = z.infer<typeof createReservationSchema>;

export const updateReservationSchema = createReservationSchema.omit({ leadId: true }).partial();
export type UpdateReservationInput = z.infer<typeof updateReservationSchema>;

export const reservationStatusSchema = z.enum(RESERVATION_STATUSES);

export const orderItemInputSchema = z.object({
  itemName: z.string().trim().min(1).max(200),
  itemSku: z.string().trim().max(100).nullable().optional(),
  quantity: z.number().int().positive(),
  unitPrice: z.number().nonnegative(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type OrderItemInput = z.infer<typeof orderItemInputSchema>;

export const updateOrderItemSchema = orderItemInputSchema.partial();
export type UpdateOrderItemInput = z.infer<typeof updateOrderItemSchema>;

export const createOrderSchema = z.object({
  locationId: z.string().uuid(),
  leadId: z.string().uuid().nullable().optional(),
  reservationId: z.string().uuid().nullable().optional(),
  orderNumber: z.string().trim().min(1).max(50),
  channel: z.enum(ORDER_CHANNELS),
  fulfillmentType: z.enum(ORDER_FULFILLMENT_TYPES),
  customerName: z.string().trim().min(1).max(200),
  phone: z.string().trim().max(50).nullable().optional(),
  discountTotal: z.number().nonnegative().optional(),
  taxTotal: z.number().nonnegative().optional(),
  deliveryFee: z.number().nonnegative().optional(),
  currency: z.string().length(3).optional(),
  requestedFor: z.string().datetime().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  items: z.array(orderItemInputSchema).min(1, "An order needs at least one item"),
});
export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export const updateOrderSchema = createOrderSchema.omit({ items: true }).partial();
export type UpdateOrderInput = z.infer<typeof updateOrderSchema>;

export const orderStatusSchema = z.enum(ORDER_STATUSES);
export const orderPaymentStatusSchema = z.enum(ORDER_PAYMENT_STATUSES);
