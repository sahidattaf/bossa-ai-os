import { regenerateKpiSnapshotPayloadV1 } from "../schemas";
import type { AiActionModule } from "./types";

export const regenerateKpiSnapshotAction: AiActionModule<{ date?: string; locationId?: string | null }> = {
  actionType: "regenerate_kpi_snapshot",
  payloadSchema: regenerateKpiSnapshotPayloadV1,
};
