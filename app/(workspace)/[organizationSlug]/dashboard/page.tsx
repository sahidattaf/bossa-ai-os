import { notFound } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { getTenantBySlug } from "@/lib/tenancy/tenants";

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  const tenant = getTenantBySlug(organizationSlug);

  if (!tenant) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Dashboard" description={`${tenant.name} — executive overview`} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <Skeleton key={index} className="h-28 w-full" />
        ))}
      </div>
    </div>
  );
}
