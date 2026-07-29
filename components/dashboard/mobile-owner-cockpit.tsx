import Link from "next/link";
import { ArrowRight, Banknote, ClipboardList, MessageCircle, Sparkles, Utensils } from "lucide-react";

import { SeverityBadge } from "@/components/ai/severity-badge";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatNumber } from "@/lib/format/kpi";
import type { DashboardData } from "@/lib/dashboard/types";
import type { TenantConfig } from "@/lib/tenancy/types";
import { cn } from "@/lib/utils";
import { hasPermission } from "@/lib/widgets/permissions";

interface MobileOwnerCockpitProps {
  tenant: TenantConfig;
  organizationSlug: string;
  data: DashboardData;
  permissions?: readonly string[];
}

interface KpiCard {
  label: string;
  value: string;
  helper: string;
  href: string;
  requiredPermission: string;
  icon: typeof Banknote;
}

function KpiTile({ card, allowed }: { card: KpiCard; allowed: boolean }) {
  const Icon = card.icon;
  const content = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[0.72rem] font-medium uppercase tracking-normal text-muted-foreground">{card.label}</span>
        <Icon className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      </div>
      <strong className="block text-2xl font-semibold leading-tight text-foreground">{allowed ? card.value : "Hidden"}</strong>
      <span className="block min-h-5 text-sm leading-snug text-muted-foreground">
        {allowed ? card.helper : `Requires ${card.requiredPermission}`}
      </span>
    </>
  );

  if (!allowed) {
    return (
      <div className="min-w-0 rounded-lg border border-border bg-surface p-4 opacity-80" aria-label={`${card.label} hidden`}>
        {content}
      </div>
    );
  }

  return (
    <Link
      href={card.href}
      className="min-w-0 rounded-lg border border-border bg-surface p-4 transition-colors hover:border-primary/70 hover:bg-surface-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      {content}
    </Link>
  );
}

export function MobileOwnerCockpit({
  tenant,
  organizationSlug,
  data,
  permissions = ["*"],
}: MobileOwnerCockpitProps) {
  const recommendationAllowed = hasPermission(permissions, "ai.executive.read");
  const recommendation = recommendationAllowed ? data.ownerCockpitRecommendation : null;
  const kpis: KpiCard[] = [
    {
      label: "Revenue Today",
      value: formatCurrency(data.revenueToday.amount, tenant.currency, tenant.locale),
      helper: data.revenueToday.amount > 0 ? "Closed revenue" : "No completed revenue yet",
      href: `/${organizationSlug}/finance`,
      requiredPermission: "finance.read",
      icon: Banknote,
    },
    {
      label: "Reservations Tonight",
      value: formatNumber(data.reservationsTonight.count, tenant.locale),
      helper:
        data.reservationsTonight.capacity > 0
          ? `${formatNumber(data.reservationsTonight.capacity, tenant.locale)} covers booked`
          : "No reservations booked",
      href: `/${organizationSlug}/reservations`,
      requiredPermission: "reservations.read",
      icon: ClipboardList,
    },
    {
      label: "Unanswered Leads",
      value: formatNumber(data.whatsappLeads.unanswered, tenant.locale),
      helper: data.whatsappLeads.unanswered > 0 ? "Need follow-up" : "Inbox is clear",
      href: `/${organizationSlug}/crm`,
      requiredPermission: "crm.read",
      icon: MessageCircle,
    },
    {
      label: "Active Orders",
      value: formatNumber(data.activeOrders.count, tenant.locale),
      helper: data.activeOrders.count > 0 ? "In progress now" : "No active orders",
      href: `/${organizationSlug}/orders`,
      requiredPermission: "orders.read",
      icon: Utensils,
    },
  ];

  return (
    <section className="flex min-w-0 flex-col gap-4" aria-label="Owner cockpit">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-normal text-primary">Owner cockpit</p>
          <h2 className="text-xl font-semibold leading-tight text-foreground">Tonight at a glance</h2>
        </div>
        <Badge variant={tenant.serviceStatus === "open" ? "success" : "secondary"} className="shrink-0 capitalize">
          {tenant.serviceStatus.replace(/_/g, " ")}
        </Badge>
      </div>

      <div className="grid min-w-0 grid-cols-2 gap-3">
        {kpis.map((card) => (
          <KpiTile key={card.label} card={card} allowed={hasPermission(permissions, card.requiredPermission)} />
        ))}
      </div>

      <div className="min-w-0 rounded-lg border border-primary/30 bg-surface p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Sparkles className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <h3 className="truncate text-sm font-semibold text-foreground">AI action</h3>
          </div>
          {recommendation ? <SeverityBadge severity={recommendation.severity} /> : null}
        </div>

        {recommendation ? (
          <div className="flex flex-col gap-3">
            <div className="min-w-0">
              <p className="text-base font-semibold leading-snug text-foreground">{recommendation.title}</p>
              <p className="mt-1 line-clamp-3 text-sm leading-6 text-muted-foreground">{recommendation.executiveSummary}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant={recommendation.priority === "High" ? "danger" : recommendation.priority === "Medium" ? "warning" : "info"}>
                {recommendation.priority} priority
              </Badge>
              <span className="capitalize">{recommendation.status.replace(/_/g, " ")}</span>
            </div>
            <Link
              href={recommendation.href}
              className={cn(
                "inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground",
                "transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
              )}
            >
              {recommendation.ctaLabel}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        ) : (
          <p className="text-sm leading-6 text-muted-foreground">
            {recommendationAllowed
              ? "No AI recommendation needs owner action right now."
              : "AI recommendations require ai.executive.read."}
          </p>
        )}
      </div>
    </section>
  );
}
