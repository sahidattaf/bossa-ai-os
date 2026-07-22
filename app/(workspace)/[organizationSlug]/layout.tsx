import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AppShell } from "@/components/layout/app-shell";
import { PermissionState } from "@/components/ui/permission-state";
import { getDashboardProviderMode } from "@/lib/dashboard/get-data-provider";
import { createClient } from "@/lib/supabase/server";
import { listMyOrganizationSummaries, resolveTenantForCurrentUser } from "@/lib/tenancy/supabase-tenants";
import { getTenantBySlug, listTenantSummaries } from "@/lib/tenancy/tenants";

import { signOut } from "@/app/(auth)/actions";

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;

  if (getDashboardProviderMode() === "mock") {
    const tenant = getTenantBySlug(organizationSlug);

    if (!tenant) {
      notFound();
    }

    return (
      <AppShell
        tenant={tenant}
        tenants={listTenantSummaries()}
        userDisplayName="Alex Ramirez"
        userRoleLabel="General Manager (demo)"
      >
        {children}
      </AppShell>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=/${organizationSlug}/dashboard`);
  }

  const access = await resolveTenantForCurrentUser(supabase, organizationSlug);

  if (access.status === "not_found") {
    notFound();
  }

  if (access.status === "no_access") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
        <PermissionState
          title={`No access to ${access.organizationName}`}
          description="You're signed in, but you don't have an active membership in this organization. Ask an organization owner to invite you, or switch to an organization you already belong to."
          className="max-w-md"
        />
      </div>
    );
  }

  const [tenants, { data: profile }] = await Promise.all([
    listMyOrganizationSummaries(supabase),
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
  ]);

  return (
    <AppShell
      tenant={access.tenant}
      tenants={tenants}
      userDisplayName={profile?.full_name || user.email || "Signed in"}
      userRoleLabel={access.roleNames.join(", ")}
      onSignOut={signOut}
    >
      {children}
    </AppShell>
  );
}
