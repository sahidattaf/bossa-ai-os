import type { CSSProperties } from "react";
import type { BorderRadiusStyle, TenantConfig, ThemeMode } from "./types";

const RADIUS_MAP: Record<BorderRadiusStyle, string> = {
  compact: "0.5rem",
  standard: "0.75rem",
  soft: "1rem",
};

/**
 * "system" can't be resolved deterministically on the server, so it falls
 * back to "dark" — the platform default — until a client-side preference
 * is wired up in a later phase.
 */
export function resolveThemeMode(mode: ThemeMode): "light" | "dark" {
  return mode === "system" ? "dark" : mode;
}

export interface TenantThemeVars {
  "--primary": string;
  "--primary-foreground": string;
  "--accent": string;
  "--accent-foreground": string;
  "--chart-1": string;
  "--radius": string;
}

/**
 * Produces the CSS custom-property overrides for one tenant's branding, to be
 * spread onto a wrapper element's `style` prop. Only brand-specific tokens are
 * overridden — surfaces, borders, and status colors stay on the shared
 * platform tokens defined in app/globals.css.
 */
export function getTenantThemeVars(tenant: TenantConfig): TenantThemeVars {
  const { branding } = tenant;
  const mode = resolveThemeMode(branding.themeMode);

  return {
    "--primary": branding.primaryColor,
    "--primary-foreground": mode === "light" ? "0 0% 100%" : "0 0% 100%",
    "--accent": branding.accentColor,
    "--accent-foreground": mode === "light" ? "0 0% 100%" : "222 47% 8%",
    "--chart-1": branding.primaryColor,
    "--radius": RADIUS_MAP[branding.borderRadius],
  };
}

export function getTenantThemeStyle(tenant: TenantConfig): CSSProperties {
  return getTenantThemeVars(tenant) as unknown as CSSProperties;
}
