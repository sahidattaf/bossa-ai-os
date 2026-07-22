import { generateDailyKpiSnapshot } from "@/lib/operations/kpi-snapshots";

import { regenerateKpiSnapshotPayloadV1 } from "../schemas";
import type { AiActionModule } from "./types";

export const regenerateKpiSnapshotAction: AiActionModule<{ date?: string; locationId?: string | null }> = {
  actionType: "regenerate_kpi_snapshot",
  payloadSchema: regenerateKpiSnapshotPayloadV1,
  async execute(supabase, organizationId, payload) {
    const snapshot = await generateDailyKpiSnapshot(supabase, organizationId, {
      date: payload.date ? new Date(payload.date) : new Date(),
      locationId: payload.locationId ?? null,
    });
    return { snapshotId: snapshot.id, revenue: snapshot.revenue, snapshotDate: snapshot.snapshot_date };
  },
};
