import { ComingSoonState } from "@/components/layout/coming-soon-state";
import { getNavItem } from "@/lib/navigation";

const NAV_ITEM = getNavItem("suppliers");

export default function SuppliersPage() {
  return (
    <ComingSoonState
      title={NAV_ITEM.label}
      icon={NAV_ITEM.icon}
      phase="Phase 3"
      description="Supplier accounts, purchase orders, and delivery tracking land with the operational modules phase."
    />
  );
}
