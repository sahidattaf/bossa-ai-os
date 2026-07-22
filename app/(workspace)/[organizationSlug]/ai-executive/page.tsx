import { ComingSoonState } from "@/components/layout/coming-soon-state";
import { getNavItem } from "@/lib/navigation";

const NAV_ITEM = getNavItem("ai-executive");

export default function AiExecutivePage() {
  return (
    <ComingSoonState
      title={NAV_ITEM.label}
      icon={NAV_ITEM.icon}
      phase="Phase 4"
      description="Signal ingestion, deterministic rules, evidence-backed recommendations, and the approval queue arrive with the AI Executive MVP."
    />
  );
}
