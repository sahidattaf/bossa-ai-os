/**
 * Hand-authored to exactly match supabase/migrations/*.sql, in the shape
 * `supabase gen types typescript --local` produces. The CI `database` job
 * regenerates this file from the real local Postgres instance and diffs it
 * against what's committed here, failing the build on drift — see
 * .github/workflows/ci.yml and docs/SUPABASE_OPERATIONS.md. This sandbox has
 * no Docker, so the generator itself couldn't be run here; CI is the source
 * of truth for correctness.
 *
 * Phase 3 note: orders.subtotal/total are schema-optional (DB defaults) and
 * typed accordingly, even though 20260722000005_operational_table_grants.sql
 * revokes INSERT/UPDATE on those two columns for `authenticated` — the
 * generator reflects column nullability/defaults, not GRANTs, so the real
 * output is expected to look the same. The application's own service layer
 * (lib/operations) never sets them; the database always computes them.
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
          status: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          slug: string;
          name: string;
          business_type?: string;
          status?: string;
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
          status: string;
          invited_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          user_id: string;
          status?: string;
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
          theme_mode: string;
          border_radius: string;
          updated_at: string;
        };
        Insert: {
          organization_id: string;
          logo_url?: string | null;
          logo_initials?: string;
          primary_color?: string;
          accent_color?: string;
          theme_mode?: string;
          border_radius?: string;
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
          service_status: string;
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
          service_status?: string;
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
      leads: {
        Row: {
          id: string;
          organization_id: string;
          location_id: string | null;
          lead_type: string;
          source: string;
          contact_name: string;
          phone: string;
          email: string | null;
          guest_count: number | null;
          requested_date: string | null;
          budget: number | null;
          message: string | null;
          status: string;
          owner_user_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          location_id?: string | null;
          lead_type: string;
          source: string;
          contact_name: string;
          phone: string;
          email?: string | null;
          guest_count?: number | null;
          requested_date?: string | null;
          budget?: number | null;
          message?: string | null;
          status?: string;
          owner_user_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["leads"]["Insert"]>;
        Relationships: [];
      };
      reservations: {
        Row: {
          id: string;
          organization_id: string;
          location_id: string;
          lead_id: string | null;
          confirmation_code: string;
          guest_name: string;
          phone: string;
          email: string | null;
          party_size: number;
          reservation_at: string;
          duration_minutes: number;
          occasion: string | null;
          notes: string | null;
          source: string;
          status: string;
          assigned_user_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          location_id: string;
          lead_id?: string | null;
          confirmation_code: string;
          guest_name: string;
          phone: string;
          email?: string | null;
          party_size: number;
          reservation_at: string;
          duration_minutes?: number;
          occasion?: string | null;
          notes?: string | null;
          source: string;
          status?: string;
          assigned_user_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["reservations"]["Insert"]>;
        Relationships: [];
      };
      orders: {
        Row: {
          id: string;
          organization_id: string;
          location_id: string;
          lead_id: string | null;
          reservation_id: string | null;
          order_number: string;
          channel: string;
          fulfillment_type: string;
          customer_name: string;
          phone: string | null;
          subtotal: number;
          discount_total: number;
          tax_total: number;
          delivery_fee: number;
          total: number;
          currency: string;
          requested_for: string | null;
          status: string;
          payment_status: string;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          location_id: string;
          lead_id?: string | null;
          reservation_id?: string | null;
          order_number: string;
          channel: string;
          fulfillment_type: string;
          customer_name: string;
          phone?: string | null;
          subtotal?: number;
          discount_total?: number;
          tax_total?: number;
          delivery_fee?: number;
          total?: number;
          currency?: string;
          requested_for?: string | null;
          status?: string;
          payment_status?: string;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["orders"]["Insert"]>;
        Relationships: [];
      };
      order_items: {
        Row: {
          id: string;
          organization_id: string;
          order_id: string;
          item_name: string;
          item_sku: string | null;
          quantity: number;
          unit_price: number;
          // Nullable even though the column has `not null` behavior in
          // practice (it's a STORED GENERATED column, always computed) —
          // the real generator types every GENERATED column as nullable
          // regardless of the underlying expression's own nullability.
          line_total: number | null;
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          order_id: string;
          item_name: string;
          item_sku?: string | null;
          quantity: number;
          unit_price: number;
          metadata?: Json;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["order_items"]["Insert"]>;
        Relationships: [];
      };
      daily_kpi_snapshots: {
        Row: {
          id: string;
          organization_id: string;
          location_id: string | null;
          snapshot_date: string;
          revenue: number;
          order_count: number;
          reservation_count: number;
          covers: number;
          new_leads: number;
          unanswered_leads: number;
          average_ticket: number;
          cancellation_count: number;
          no_show_count: number;
          metadata: Json;
          generated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          location_id?: string | null;
          snapshot_date: string;
          revenue?: number;
          order_count?: number;
          reservation_count?: number;
          covers?: number;
          new_leads?: number;
          unanswered_leads?: number;
          average_ticket?: number;
          cancellation_count?: number;
          no_show_count?: number;
          metadata?: Json;
          generated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["daily_kpi_snapshots"]["Insert"]>;
        Relationships: [];
      };
      status_transitions: {
        Row: { machine: string; from_status: string; to_status: string };
        Insert: { machine: string; from_status: string; to_status: string };
        Update: Partial<Database["public"]["Tables"]["status_transitions"]["Insert"]>;
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
      calculate_daily_kpi_snapshot: {
        Args: { p_organization_id: string; p_snapshot_date?: string; p_location_id?: string };
        Returns: Database["public"]["Tables"]["daily_kpi_snapshots"]["Row"];
      };
      get_dashboard_snapshot: {
        Args: { p_organization_id: string; p_as_of?: string };
        Returns: Json;
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
