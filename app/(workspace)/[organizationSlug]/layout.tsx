import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { AppShell } from "@/components/layout/app-shell";
import { getTenantBySlug } from "@/lib/tenancy/tenants";

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  const tenant = getTenantBySlug(organizationSlug);

  if (!tenant) {
    notFound();
  }

  return <AppShell tenant={tenant}>{children}</AppShell>;
}
