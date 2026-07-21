import Link from "next/link";
import { Building2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { listTenantSummaries } from "@/lib/tenancy/tenants";

export default function OrganizationNotFound() {
  const tenants = listTenantSummaries();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <EmptyState
        icon={Building2}
        title="We couldn't find that organization"
        description="Check the workspace link, or choose an active organization below."
        action={
          <div className="flex flex-wrap justify-center gap-2">
            {tenants.map((tenant) => (
              <Button key={tenant.id} variant="outline" size="sm" asChild>
                <Link href={`/${tenant.slug}/dashboard`}>{tenant.name}</Link>
              </Button>
            ))}
          </div>
        }
        className="max-w-md"
      />
    </div>
  );
}
