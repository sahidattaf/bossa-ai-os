import { ComingSoonState } from "@/components/layout/coming-soon-state";
import { getNavItem } from "@/lib/navigation";

const NAV_ITEM = getNavItem("kitchen");

export default function KitchenPage() {
  return (
    <ComingSoonState
      title={NAV_ITEM.label}
      icon={NAV_ITEM.icon}
      phase="Phase 3"
      description="Kitchen display routing and prep-station views land with the operational modules phase."
    />
  );
}
