import { ComingSoonState } from "@/components/layout/coming-soon-state";
import { getNavItem } from "@/lib/navigation";

const NAV_ITEM = getNavItem("integrations");

export default function IntegrationsPage() {
  return (
    <ComingSoonState
      title={NAV_ITEM.label}
      icon={NAV_ITEM.icon}
      phase="Phase 5"
      description="Notion sync, WhatsApp, Google Calendar, Google Reviews, and POS connectors land with the integrations phase."
    />
  );
}
