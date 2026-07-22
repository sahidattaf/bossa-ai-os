import type { SupabaseClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";

import { getDashboardProviderMode } from "@/lib/dashboard/get-data-provider";
import type { Database } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

import { resolveTenantForCurrentUser } from "./supabase-tenants";
import { getTenantBySlug } from "./tenants";
import type { TenantConfig } from "./types";

export type WorkspacePageContext =
  | { mode: "mock"; tenant: TenantConfig; permissions: string[]; supabase: null }
  | { mode: "supabase"; tenant: TenantConfig; permissions: string[]; supabase: SupabaseClient<Database> };

/**
 * Shared mock-vs-supabase resolution for every operational page (orders,
 * reservations, crm), following the same pattern dashboard/page.tsx already
 * established: the workspace layout has already authenticated and
 * authorized this request in `supabase` mode, so re-deriving it here is a
 * free, cache()d call — any non-"ok" result means the layout's own gate has
 * a bug, not a real access grant, so this fails closed with notFound()
 * rather than rendering partial data.
 */
export async function resolveWorkspacePageContext(organizationSlug: string): Promise<WorkspacePageContext> {
  if (getDashboardProviderMode() === "mock") {
    const tenant = getTenantBySlug(organizationSlug);
    if (!tenant) {
      notFound();
    }
    return { mode: "mock", tenant, permissions: ["*"], supabase: null };
  }

  const supabase = await createClient();
  const access = await resolveTenantForCurrentUser(supabase, organizationSlug);
  if (access.status !== "ok") {
    notFound();
  }

  return { mode: "supabase", tenant: access.tenant, permissions: access.permissions, supabase };
}
