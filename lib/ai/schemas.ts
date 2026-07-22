import { z } from "zod";

import { AI_ACTION_TYPES, AI_RISK_LEVELS, AI_SEVERITIES, AI_SOURCE_ENTITY_TYPES, type AiActionType } from "./status";

// Versioned action payload schemas (v1) --------------------------------------
// One per allow-listed action type (issue #18 decision #8). These are the
// *only* payload shapes the action router will ever accept — anything else
// is rejected before any write occurs. A future v2 of any action type gets
// its own schema and its own `action_schema_version` value; existing rows
// keep validating against v1 forever.

export const assignLeadOwnerPayloadV1 = z.object({
  leadId: z.string().uuid(),
  ownerUserId: z.string().uuid(),
});

export const changeLeadStatusPayloadV1 = z.object({
  leadId: z.string().uuid(),
  status: z.string().min(1),
});

export const confirmReservationPayloadV1 = z.object({
  reservationId: z.string().uuid(),
});

export const cancelReservationPayloadV1 = z.object({
  reservationId: z.string().uuid(),
});

export const changeOrderStatusPayloadV1 = z.object({
  orderId: z.string().uuid(),
  status: z.string().min(1),
});

export const changeOrderPaymentStatusPayloadV1 = z.object({
  orderId: z.string().uuid(),
  paymentStatus: z.string().min(1),
});

export const regenerateKpiSnapshotPayloadV1 = z.object({
  date: z.string().min(1).optional(),
  locationId: z.string().uuid().nullable().optional(),
});

export const navigatePayloadV1 = z.object({
  route: z.string().min(1).startsWith("/"),
  label: z.string().min(1).optional(),
});

/** Keyed by AiActionType — exhaustively, so a new allow-listed type without a schema is a compile error. */
export const ACTION_PAYLOAD_SCHEMAS_V1 = {
  assign_lead_owner: assignLeadOwnerPayloadV1,
  change_lead_status: changeLeadStatusPayloadV1,
  confirm_reservation: confirmReservationPayloadV1,
  cancel_reservation: cancelReservationPayloadV1,
  change_order_status: changeOrderStatusPayloadV1,
  change_order_payment_status: changeOrderPaymentStatusPayloadV1,
  regenerate_kpi_snapshot: regenerateKpiSnapshotPayloadV1,
  navigate: navigatePayloadV1,
} satisfies Record<AiActionType, z.ZodType>;

export type AssignLeadOwnerPayload = z.infer<typeof assignLeadOwnerPayloadV1>;
export type ChangeLeadStatusPayload = z.infer<typeof changeLeadStatusPayloadV1>;
export type ConfirmReservationPayload = z.infer<typeof confirmReservationPayloadV1>;
export type CancelReservationPayload = z.infer<typeof cancelReservationPayloadV1>;
export type ChangeOrderStatusPayload = z.infer<typeof changeOrderStatusPayloadV1>;
export type ChangeOrderPaymentStatusPayload = z.infer<typeof changeOrderPaymentStatusPayloadV1>;
export type RegenerateKpiSnapshotPayload = z.infer<typeof regenerateKpiSnapshotPayloadV1>;
export type NavigatePayload = z.infer<typeof navigatePayloadV1>;

// Evaluation intent contract --------------------------------------------------
// Shape produced by lib/ai/rules/*.ts and validated here before
// lib/ai/evaluate.ts calls the apply_ai_evaluation() RPC — this is the last
// TypeScript-side check before the single transactional apply, including
// verifying each recommendation's action payload against its declared
// action type's own versioned schema.

export const evidenceIntentSchema = z.object({
  metricName: z.string().min(1),
  observedValue: z.unknown(),
  expectedValue: z.unknown().optional(),
  sourceEntityType: z.enum(AI_SOURCE_ENTITY_TYPES).optional(),
  sourceEntityId: z.string().uuid().optional(),
  calculationDefinition: z.string().min(1),
  isFinanceSensitive: z.boolean().optional(),
});
export type EvidenceIntent = z.infer<typeof evidenceIntentSchema>;

export const signalIntentSchema = z.object({
  signalType: z.string().min(1),
  locationId: z.string().uuid().optional(),
  severity: z.enum(AI_SEVERITIES),
  title: z.string().min(1),
  facts: z.record(z.string(), z.unknown()).optional(),
  observedAt: z.string().optional(),
  dedupeKey: z.string().min(1),
  sourceEntityType: z.enum(AI_SOURCE_ENTITY_TYPES).optional(),
  sourceEntityId: z.string().uuid().optional(),
});
export type SignalIntent = z.infer<typeof signalIntentSchema>;

export const recommendationIntentSchema = z
  .object({
    dedupeKey: z.string().min(1),
    locationId: z.string().uuid().optional(),
    recommendationType: z.string().min(1),
    title: z.string().min(1),
    executiveSummary: z.string().min(1),
    severity: z.enum(AI_SEVERITIES),
    priorityScore: z.number().int().min(0).max(100).optional(),
    recommendedActionType: z.enum(AI_ACTION_TYPES),
    actionSchemaVersion: z.string().optional(),
    recommendedActionPayload: z.record(z.string(), z.unknown()),
    expectedBenefit: z.string().optional(),
    riskLevel: z.enum(AI_RISK_LEVELS).optional(),
    requiresApproval: z.boolean().optional(),
    ruleId: z.string().min(1),
    expiresAt: z.string().optional(),
    evidence: z.array(evidenceIntentSchema).default([]),
  })
  .superRefine((value, ctx) => {
    const payloadSchema = ACTION_PAYLOAD_SCHEMAS_V1[value.recommendedActionType];
    const result = payloadSchema.safeParse(value.recommendedActionPayload);
    if (!result.success) {
      ctx.addIssue({
        code: "custom",
        message: `recommendedActionPayload does not match "${value.recommendedActionType}"'s schema: ${result.error.message}`,
        path: ["recommendedActionPayload"],
      });
    }
  });
export type RecommendationIntent = z.infer<typeof recommendationIntentSchema>;

export const evaluationIntentsSchema = z.object({
  signals: z.array(signalIntentSchema).default([]),
  recommendations: z.array(recommendationIntentSchema).default([]),
});
export type EvaluationIntents = z.infer<typeof evaluationIntentsSchema>;
