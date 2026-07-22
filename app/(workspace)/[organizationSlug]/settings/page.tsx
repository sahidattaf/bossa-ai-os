import { ComingSoonState } from "@/components/layout/coming-soon-state";
import { getNavItem } from "@/lib/navigation";

const NAV_ITEM = getNavItem("settings");

export default function SettingsPage() {
  return (
    <ComingSoonState
      title={NAV_ITEM.label}
      icon={NAV_ITEM.icon}
      phase="a future release"
      description="The membership, role, and branding data model shipped in Phase 2 — a UI to manage members, roles, and branding directly lands in a later release."
    />
  );
}
