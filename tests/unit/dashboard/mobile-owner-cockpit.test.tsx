import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MobileOwnerCockpit } from "@/components/dashboard/mobile-owner-cockpit";
import { BOSSA_DASHBOARD_DATA } from "@/lib/dashboard/mock-data/bossa";
import type { DashboardData } from "@/lib/dashboard/types";
import { getTenantBySlug } from "@/lib/tenancy/tenants";

const tenant = getTenantBySlug("bossa")!;
const allPermissions = [
  "finance.read",
  "reservations.read",
  "crm.read",
  "orders.read",
  "ai.executive.read",
  "ai.actions.approve",
];

function cloneData(overrides: Partial<DashboardData> = {}): DashboardData {
  return {
    ...structuredClone(BOSSA_DASHBOARD_DATA),
    ...overrides,
  };
}

function renderCockpit(data = cloneData(), permissions: readonly string[] = allPermissions) {
  return render(
    <MobileOwnerCockpit tenant={tenant} organizationSlug="bossa" data={data} permissions={permissions} />,
  );
}

describe("MobileOwnerCockpit", () => {
  it("renders the four owner KPI values", () => {
    renderCockpit();

    expect(screen.getByText("$45,000")).toBeInTheDocument();
    expect(screen.getByText("65")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("9")).toBeInTheDocument();
  });

  it("renders active orders as distinct from orders today", () => {
    renderCockpit(cloneData({ ordersToday: { ...BOSSA_DASHBOARD_DATA.ordersToday, count: 186 } }));

    expect(screen.getByText("9")).toBeInTheDocument();
    expect(screen.queryByText("186")).not.toBeInTheDocument();
  });

  it("renders honest zero states", () => {
    renderCockpit(
      cloneData({
        revenueToday: { ...BOSSA_DASHBOARD_DATA.revenueToday, amount: 0 },
        reservationsTonight: { ...BOSSA_DASHBOARD_DATA.reservationsTonight, count: 0, capacity: 0 },
        whatsappLeads: { ...BOSSA_DASHBOARD_DATA.whatsappLeads, unanswered: 0 },
        activeOrders: { ...BOSSA_DASHBOARD_DATA.activeOrders, count: 0 },
      }),
    );

    expect(screen.getByText("$0")).toBeInTheDocument();
    expect(screen.getByText("No completed revenue yet")).toBeInTheDocument();
    expect(screen.getByText("No reservations booked")).toBeInTheDocument();
    expect(screen.getByText("Inbox is clear")).toBeInTheDocument();
    expect(screen.getByText("No active orders")).toBeInTheDocument();
  });

  it("links KPI cards to their protected workspace destinations", () => {
    renderCockpit();

    expect(screen.getByRole("link", { name: /Revenue Today/i })).toHaveAttribute("href", "/bossa/finance");
    expect(screen.getByRole("link", { name: /Reservations Tonight/i })).toHaveAttribute("href", "/bossa/reservations");
    expect(screen.getByRole("link", { name: /Unanswered Leads/i })).toHaveAttribute("href", "/bossa/crm");
    expect(screen.getByRole("link", { name: /Active Orders/i })).toHaveAttribute("href", "/bossa/orders");
  });

  it("prefers a pending approval recommendation CTA", () => {
    renderCockpit();

    expect(screen.getByText("Approve weekend value bundle campaign")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Review approval/i })).toHaveAttribute(
      "href",
      "/bossa/ai-executive/approvals",
    );
  });

  it("uses the recommendation detail CTA when no approval is pending", () => {
    renderCockpit(
      cloneData({
        ownerCockpitRecommendation: {
          id: "rec-1",
          title: "Review delayed order handoff",
          severity: "warning",
          priority: "Medium",
          executiveSummary: "A delayed order needs manager attention before guest recovery escalates.",
          status: "approved",
          href: "/bossa/ai-executive/recommendations/rec-1",
          ctaLabel: "Open recommendation",
          hasPendingApproval: false,
        },
      }),
    );

    expect(screen.getByText("Review delayed order handoff")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open recommendation/i })).toHaveAttribute(
      "href",
      "/bossa/ai-executive/recommendations/rec-1",
    );
  });

  it("renders an empty AI state", () => {
    renderCockpit(cloneData({ ownerCockpitRecommendation: null }));

    expect(screen.getByText("No AI recommendation needs owner action right now.")).toBeInTheDocument();
  });

  it("fails closed for missing permissions", () => {
    renderCockpit(cloneData(), ["reservations.read", "orders.read"]);

    expect(screen.getByLabelText("Revenue Today hidden")).toBeInTheDocument();
    expect(screen.getByLabelText("Unanswered Leads hidden")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Revenue Today/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Unanswered Leads/i })).not.toBeInTheDocument();
    expect(screen.getByText("AI recommendations require ai.executive.read.")).toBeInTheDocument();
  });

  it("uses a two-column mobile grid without fixed-width cockpit containers", () => {
    const { container } = renderCockpit();
    const section = container.querySelector("section");
    const grid = container.querySelector(".grid");

    expect(section).toHaveClass("min-w-0");
    expect(grid).toHaveClass("grid-cols-2");
    expect(container.innerHTML).not.toMatch(/w-\[\d/);
    expect(container.innerHTML).not.toMatch(/min-w-\[\d/);
  });
});
