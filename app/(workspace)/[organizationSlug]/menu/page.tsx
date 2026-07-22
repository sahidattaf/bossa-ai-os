import { ComingSoonState } from "@/components/layout/coming-soon-state";
import { getNavItem } from "@/lib/navigation";

const NAV_ITEM = getNavItem("menu");

export default function MenuPage() {
  return (
    <ComingSoonState
      title={NAV_ITEM.label}
      icon={NAV_ITEM.icon}
      phase="Phase 3"
      description="Recipe costing, ingredient breakdowns, and menu-item margin tracking land with the operational modules phase."
    />
  );
}
