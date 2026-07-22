/**
 * Hand-authored to exactly match supabase/migrations/*.sql, in the shape
 * `supabase gen types typescript --local` produces. The CI `database` job
 * regenerates this file from the real local Postgres instance and diffs it
 * against what's committed here, failing the build on drift — see
 * .github/workflows/ci.yml and docs/SUPABASE_OPERATIONS.md. This sandbox has
 * no Docker, so the generator itself couldn't be run here; CI is the source
 * of truth for correctness.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  __InternalSupabase: {
    PostgrestVersion: "12";
  };
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          full_name: string | null;
          avatar_url: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          full_name?: string | null;
          avatar_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Insert"]>;
        Relationships: [];
      };
      platform_admins: {
        Row: { user_id: string; created_at: string };
        Insert: { user_id: string; created_at?: string };
        Update: Partial<Database["public"]["Tables"]["platform_admins"]["Insert"]>;
        Relationships: [];
      };
      organizations: {
        Row: {
          id: string;
          slug: string;
          name: string;
          business_type: string;
          status: "active" | "onboarding" | "paused" | "archived";
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          slug: string;
          name: string;
          business_type?: string;
          status?: "active" | "onboarding" | "paused" | "archived";
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["organizations"]["Insert"]>;
        Relationships: [];
      };
      locations: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          is_primary: boolean;
          timezone: string;
          currency: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name: string;
          is_primary?: boolean;
          timezone?: string;
          currency?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["locations"]["Insert"]>;
        Relationships: [];
      };
      organization_memberships: {
        Row: {
          id: string;
          organization_id: string;
          user_id: string;
          status: "active" | "invited" | "suspended";
          invited_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          user_id: string;
          status?: "active" | "invited" | "suspended";
          invited_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["organization_memberships"]["Insert"]>;
        Relationships: [];
      };
      roles: {
        Row: {
          id: string;
          key: string;
          name: string;
          description: string;
          is_platform_role: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          key: string;
          name: string;
          description?: string;
          is_platform_role?: boolean;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["roles"]["Insert"]>;
        Relationships: [];
      };
      permissions: {
        Row: { id: string; key: string; description: string; created_at: string };
        Insert: { id?: string; key: string; description?: string; created_at?: string };
        Update: Partial<Database["public"]["Tables"]["permissions"]["Insert"]>;
        Relationships: [];
      };
      role_permissions: {
        Row: { role_id: string; permission_id: string };
        Insert: { role_id: string; permission_id: string };
        Update: Partial<Database["public"]["Tables"]["role_permissions"]["Insert"]>;
        Relationships: [];
      };
      membership_roles: {
        Row: {
          id: string;
          membership_id: string;
          role_id: string;
          organization_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          membership_id: string;
          role_id: string;
          organization_id?: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["membership_roles"]["Insert"]>;
        Relationships: [];
      };
      organization_branding: {
        Row: {
          organization_id: string;
          logo_url: string | null;
          logo_initials: string;
          primary_color: string;
          accent_color: string;
          theme_mode: "light" | "dark" | "system";
          border_radius: "compact" | "standard" | "soft";
          updated_at: string;
        };
        Insert: {
          organization_id: string;
          logo_url?: string | null;
          logo_initials?: string;
          primary_color?: string;
          accent_color?: string;
          theme_mode?: "light" | "dark" | "system";
          border_radius?: "compact" | "standard" | "soft";
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["organization_branding"]["Insert"]>;
        Relationships: [];
      };
      organization_settings: {
        Row: {
          organization_id: string;
          locale: string;
          timezone: string;
          currency: string;
          service_status: "open" | "busy" | "opening_soon" | "closed";
          ai_manager_name: string;
          product_kpi_label: string;
          product_kpi_unit: string | null;
          dashboard_widgets: Json;
          updated_at: string;
        };
        Insert: {
          organization_id: string;
          locale?: string;
          timezone?: string;
          currency?: string;
          service_status?: "open" | "busy" | "opening_soon" | "closed";
          ai_manager_name?: string;
          product_kpi_label?: string;
          product_kpi_unit?: string | null;
          dashboard_widgets?: Json;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["organization_settings"]["Insert"]>;
        Relationships: [];
      };
      audit_logs: {
        Row: {
          id: string;
          organization_id: string | null;
          actor_user_id: string | null;
          action: string;
          entity_type: string;
          entity_id: string | null;
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id?: string | null;
          actor_user_id?: string | null;
          action: string;
          entity_type: string;
          entity_id?: string | null;
          metadata?: Json;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["audit_logs"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      is_org_member: {
        Args: { p_organization_id: string };
        Returns: boolean;
      };
      has_permission: {
        Args: { p_organization_id: string; p_permission_key: string };
        Returns: boolean;
      };
      record_audit_event: {
        Args: {
          p_organization_id: string | null;
          p_action: string;
          p_entity_type: string;
          p_entity_id?: string | null;
          p_metadata?: Json;
        };
        Returns: string;
      };
      get_organization_summary: {
        Args: { p_slug: string };
        Returns: { id: string; slug: string; name: string }[];
      };
      get_my_permissions: {
        Args: { p_organization_id: string };
        Returns: string[];
      };
      get_my_role_names: {
        Args: { p_organization_id: string };
        Returns: string[];
      };
    };
    Enums: Record<string, never>;
  };
}

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
export type TablesInsert<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Update"];
