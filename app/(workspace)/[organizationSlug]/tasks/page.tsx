import { ComingSoonState } from "@/components/layout/coming-soon-state";
import { getNavItem } from "@/lib/navigation";

const NAV_ITEM = getNavItem("tasks");

export default function TasksPage() {
  return (
    <ComingSoonState
      title={NAV_ITEM.label}
      icon={NAV_ITEM.icon}
      phase="Phase 3"
      description="SOP runs, task ownership, and completion tracking land with the operational modules phase."
    />
  );
}
