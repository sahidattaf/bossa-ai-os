import { Users } from "lucide-react";

import { StatusBadge } from "@/components/operations/status-badge";
import { InlineStatusForm } from "@/components/operations/inline-status-form";
import { LeadConversionActions } from "@/components/operations/lead-conversion-actions";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader } from "@/components/layout/page-header";
import { PermissionState } from "@/components/ui/permission-state";
import { hasPermission } from "@/lib/widgets/permissions";
import { listLeads } from "@/lib/operations/leads";
import { getMockLeads } from "@/lib/operations/mock-fixtures";
import { isLeadConvertible } from "@/lib/operations/conversions";
import { LEAD_STATUSES } from "@/lib/operations/status";
import { resolveWorkspacePageContext } from "@/lib/tenancy/page-context";
import { toOperationalError } from "@/lib/errors";

import { updateLeadStatusAction } from "./actions";
import { CreateLeadForm } from "./create-lead-form";

export default async function CrmPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationSlug: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { organizationSlug } = await params;
  const { status: statusFilter } = await searchParams;
  const context = await resolveWorkspacePageContext(organizationSlug);

  if (!hasPermission(context.permissions, "crm.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="CRM" description="Leads and guest intake" />
        <PermissionState requiredPermission="crm.read" />
      </div>
    );
  }

  const canWrite = hasPermission(context.permissions, "crm.write");
  const canConvertToReservation = canWrite && hasPermission(context.permissions, "reservations.write");
  const canConvertToOrder = canWrite && hasPermission(context.permissions, "orders.write");

  interface LeadDisplayRow {
    id: string;
    contactName: string;
    phone: string;
    leadType: string;
    source: string;
    status: string;
  }

  let leads: LeadDisplayRow[] = [];
  let loadError: string | null = null;
  let locations: { id: string; name: string }[] = [];

  if (context.mode === "mock") {
    leads = getMockLeads(context.tenant.id).map((lead) => ({
      id: lead.id,
      contactName: lead.contactName,
      phone: lead.phone,
      leadType: lead.leadType,
      source: lead.source,
      status: lead.status,
    }));
  } else {
    try {
      const [rows, { data: locationRows }] = await Promise.all([
        listLeads(context.supabase, context.tenant.id, { status: statusFilter }),
        context.supabase.from("locations").select("id, name").eq("organization_id", context.tenant.id),
      ]);
      leads = rows.map((row) => ({
        id: row.id,
        contactName: row.contact_name,
        phone: row.phone,
        leadType: row.lead_type,
        source: row.source,
        status: row.status,
      }));
      locations = locationRows ?? [];
    } catch (error) {
      loadError = toOperationalError(error as never).message;
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="CRM" description={`${context.tenant.name} — leads and guest intake`} />

      {context.mode === "mock" ? (
        <p className="rounded-md border border-dashed border-border bg-surface-elevated/50 px-4 py-2 text-xs text-muted-foreground">
          Demo mode — read-only. Fictional leads shown below; creating or updating leads requires a live
          organization.
        </p>
      ) : canWrite ? (
        <Card>
          <CardContent className="pt-5">
            <CreateLeadForm organizationSlug={organizationSlug} />
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <a
          href={`/${organizationSlug}/crm`}
          className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-surface-elevated"
        >
          All
        </a>
        {LEAD_STATUSES.map((status) => (
          <a
            key={status}
            href={`/${organizationSlug}/crm?status=${status}`}
            className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-surface-elevated"
          >
            {status.replace(/_/g, " ")}
          </a>
        ))}
      </div>

      {loadError ? (
        <ErrorState description={loadError} />
      ) : leads.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No leads yet"
          description="Leads coming in from WhatsApp, phone, or the website will show up here."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-surface-elevated/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Contact</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Source</th>
                <th className="px-4 py-3 font-medium">Status</th>
                {context.mode === "supabase" && (canConvertToReservation || canConvertToOrder) ? (
                  <th className="px-4 py-3 font-medium">Convert</th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => (
                <tr key={lead.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{lead.contactName}</div>
                    <div className="text-xs text-muted-foreground">{lead.phone}</div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{lead.leadType}</td>
                  <td className="px-4 py-3 text-muted-foreground">{lead.source.replace(/_/g, " ")}</td>
                  <td className="px-4 py-3">
                    {context.mode === "supabase" && canWrite ? (
                      <InlineStatusForm
                        action={updateLeadStatusAction}
                        hiddenFields={{ organizationSlug, leadId: lead.id }}
                        currentStatus={lead.status}
                        options={LEAD_STATUSES}
                      />
                    ) : (
                      <StatusBadge status={lead.status} />
                    )}
                  </td>
                  {context.mode === "supabase" && (canConvertToReservation || canConvertToOrder) ? (
                    <td className="px-4 py-3">
                      <LeadConversionActions
                        organizationSlug={organizationSlug}
                        leadId={lead.id}
                        leadStatus={lead.status}
                        contactName={lead.contactName}
                        phone={lead.phone}
                        canConvertToReservation={canConvertToReservation && isLeadConvertible(lead.status)}
                        canConvertToOrder={canConvertToOrder && isLeadConvertible(lead.status)}
                        locations={locations}
                      />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
