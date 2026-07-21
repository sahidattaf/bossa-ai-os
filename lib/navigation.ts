import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Boxes,
  CalendarCheck,
  ChefHat,
  LayoutDashboard,
  ListChecks,
  Megaphone,
  Plug,
  Settings,
  ShoppingCart,
  Sparkles,
  Star,
  Truck,
  UserCog,
  Users,
  UtensilsCrossed,
  Wallet,
} from "lucide-react";

export interface NavItem {
  label: string;
  segment: string;
  icon: LucideIcon;
  /** Modules beyond Dashboard ship as a "coming in Phase X" state in Phase 1. */
  availableInPhase1: boolean;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { label: "Dashboard", segment: "dashboard", icon: LayoutDashboard, availableInPhase1: true },
  { label: "AI Executive", segment: "ai-executive", icon: Sparkles, availableInPhase1: false },
  { label: "Orders", segment: "orders", icon: ShoppingCart, availableInPhase1: false },
  {
    label: "Reservations",
    segment: "reservations",
    icon: CalendarCheck,
    availableInPhase1: false,
  },
  { label: "CRM", segment: "crm", icon: Users, availableInPhase1: false },
  { label: "Kitchen", segment: "kitchen", icon: ChefHat, availableInPhase1: false },
  {
    label: "Menu & Costing",
    segment: "menu",
    icon: UtensilsCrossed,
    availableInPhase1: false,
  },
  { label: "Inventory", segment: "inventory", icon: Boxes, availableInPhase1: false },
  { label: "Suppliers", segment: "suppliers", icon: Truck, availableInPhase1: false },
  { label: "Reviews", segment: "reviews", icon: Star, availableInPhase1: false },
  { label: "Marketing", segment: "marketing", icon: Megaphone, availableInPhase1: false },
  { label: "Finance", segment: "finance", icon: Wallet, availableInPhase1: false },
  { label: "Staff", segment: "staff", icon: UserCog, availableInPhase1: false },
  { label: "Tasks & SOPs", segment: "tasks", icon: ListChecks, availableInPhase1: false },
  { label: "Reports", segment: "reports", icon: BarChart3, availableInPhase1: false },
  { label: "Integrations", segment: "integrations", icon: Plug, availableInPhase1: false },
  { label: "Settings", segment: "settings", icon: Settings, availableInPhase1: false },
];

export function getNavItem(segment: string): NavItem {
  const item = NAV_ITEMS.find((navItem) => navItem.segment === segment);
  if (!item) {
    throw new Error(`Unknown navigation segment: ${segment}`);
  }
  return item;
}
