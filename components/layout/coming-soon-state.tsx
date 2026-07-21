import type { LucideIcon } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";

export interface ComingSoonStateProps {
  title: string;
  icon: LucideIcon;
  phase: string;
  description: string;
}

function ComingSoonState({ title, icon, phase, description }: ComingSoonStateProps) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={title} description={`Live in ${phase} of the Hospitality OS roadmap.`} />
      <EmptyState icon={icon} title={`${title} is coming in ${phase}`} description={description} />
    </div>
  );
}

export { ComingSoonState };
