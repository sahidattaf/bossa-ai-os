export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      ai_action_attempts: {
        Row: {
          action_payload: Json
          action_type: string
          actor_user_id: string | null
          approval_id: string | null
          attempted_at: string
          duration_ms: number | null
          error_code: string | null
          error_message: string | null
          id: string
          organization_id: string
          payload_hash: string
          recommendation_id: string
          result_detail: Json
          result_status: string
        }
        Insert: {
          action_payload: Json
          action_type: string
          actor_user_id?: string | null
          approval_id?: string | null
          attempted_at?: string
          duration_ms?: number | null
          error_code?: string | null
          error_message?: string | null
          id?: string
          organization_id: string
          payload_hash: string
          recommendation_id: string
          result_detail?: Json
          result_status: string
        }
        Update: {
          action_payload?: Json
          action_type?: string
          actor_user_id?: string | null
          approval_id?: string | null
          attempted_at?: string
          duration_ms?: number | null
          error_code?: string | null
          error_message?: string | null
          id?: string
          organization_id?: string
          payload_hash?: string
          recommendation_id?: string
          result_detail?: Json
          result_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_action_attempts_organization_id_approval_id_fkey"
            columns: ["organization_id", "approval_id"]
            isOneToOne: false
            referencedRelation: "ai_approvals"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "ai_action_attempts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_action_attempts_organization_id_recommendation_id_fkey"
            columns: ["organization_id", "recommendation_id"]
            isOneToOne: false
            referencedRelation: "ai_recommendations"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      ai_approvals: {
        Row: {
          created_at: string
          decided_at: string | null
          decided_by_user_id: string | null
          expires_at: string | null
          id: string
          organization_id: string
          payload_hash_at_decision: string | null
          reason: string | null
          recommendation_id: string
          status: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          decided_by_user_id?: string | null
          expires_at?: string | null
          id?: string
          organization_id: string
          payload_hash_at_decision?: string | null
          reason?: string | null
          recommendation_id: string
          status?: string
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decided_by_user_id?: string | null
          expires_at?: string | null
          id?: string
          organization_id?: string
          payload_hash_at_decision?: string | null
          reason?: string | null
          recommendation_id?: string
          status?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "ai_approvals_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_approvals_organization_id_recommendation_id_fkey"
            columns: ["organization_id", "recommendation_id"]
            isOneToOne: false
            referencedRelation: "ai_recommendations"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      ai_outcomes: {
        Row: {
          action_attempt_id: string | null
          after_snapshot: Json
          before_snapshot: Json
          created_at: string
          failure_code: string | null
          failure_message: string | null
          human_notes: string | null
          id: string
          measured_at: string | null
          organization_id: string
          outcome_metrics: Json
          recommendation_id: string
          status: string
          updated_at: string
        }
        Insert: {
          action_attempt_id?: string | null
          after_snapshot?: Json
          before_snapshot?: Json
          created_at?: string
          failure_code?: string | null
          failure_message?: string | null
          human_notes?: string | null
          id?: string
          measured_at?: string | null
          organization_id: string
          outcome_metrics?: Json
          recommendation_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          action_attempt_id?: string | null
          after_snapshot?: Json
          before_snapshot?: Json
          created_at?: string
          failure_code?: string | null
          failure_message?: string | null
          human_notes?: string | null
          id?: string
          measured_at?: string | null
          organization_id?: string
          outcome_metrics?: Json
          recommendation_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_outcomes_organization_id_action_attempt_id_fkey"
            columns: ["organization_id", "action_attempt_id"]
            isOneToOne: false
            referencedRelation: "ai_action_attempts"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "ai_outcomes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_outcomes_organization_id_recommendation_id_fkey"
            columns: ["organization_id", "recommendation_id"]
            isOneToOne: false
            referencedRelation: "ai_recommendations"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      ai_recommendation_evidence: {
        Row: {
          calculation_definition: string
          created_at: string
          expected_value: Json | null
          id: string
          is_finance_sensitive: boolean
          metric_name: string
          observed_value: Json
          organization_id: string
          recommendation_id: string
          source_entity_id: string | null
          source_entity_type: string | null
        }
        Insert: {
          calculation_definition: string
          created_at?: string
          expected_value?: Json | null
          id?: string
          is_finance_sensitive?: boolean
          metric_name: string
          observed_value: Json
          organization_id: string
          recommendation_id: string
          source_entity_id?: string | null
          source_entity_type?: string | null
        }
        Update: {
          calculation_definition?: string
          created_at?: string
          expected_value?: Json | null
          id?: string
          is_finance_sensitive?: boolean
          metric_name?: string
          observed_value?: Json
          organization_id?: string
          recommendation_id?: string
          source_entity_id?: string | null
          source_entity_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_recommendation_evidence_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_recommendation_evidence_organization_id_recommendation__fkey"
            columns: ["organization_id", "recommendation_id"]
            isOneToOne: false
            referencedRelation: "ai_recommendations"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      ai_recommendations: {
        Row: {
          action_schema_version: string
          created_at: string
          dedupe_key: string
          executive_summary: string
          expected_benefit: string | null
          expires_at: string | null
          id: string
          location_id: string | null
          organization_id: string
          payload_hash: string | null
          priority_score: number
          recommendation_type: string
          recommended_action_payload: Json
          recommended_action_type: string
          requires_approval: boolean
          risk_level: string
          rule_id: string
          rule_version: string
          severity: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          action_schema_version?: string
          created_at?: string
          dedupe_key: string
          executive_summary: string
          expected_benefit?: string | null
          expires_at?: string | null
          id?: string
          location_id?: string | null
          organization_id: string
          payload_hash?: string | null
          priority_score?: number
          recommendation_type: string
          recommended_action_payload?: Json
          recommended_action_type: string
          requires_approval?: boolean
          risk_level?: string
          rule_id: string
          rule_version: string
          severity: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          action_schema_version?: string
          created_at?: string
          dedupe_key?: string
          executive_summary?: string
          expected_benefit?: string | null
          expires_at?: string | null
          id?: string
          location_id?: string | null
          organization_id?: string
          payload_hash?: string | null
          priority_score?: number
          recommendation_type?: string
          recommended_action_payload?: Json
          recommended_action_type?: string
          requires_approval?: boolean
          risk_level?: string
          rule_id?: string
          rule_version?: string
          severity?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_recommendations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_recommendations_organization_id_location_id_fkey"
            columns: ["organization_id", "location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      ai_rule_configs: {
        Row: {
          config: Json
          created_at: string
          enabled: boolean
          id: string
          location_id: string | null
          organization_id: string
          rule_key: string
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          enabled?: boolean
          id?: string
          location_id?: string | null
          organization_id: string
          rule_key: string
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          enabled?: boolean
          id?: string
          location_id?: string | null
          organization_id?: string
          rule_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_rule_configs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_rule_configs_organization_id_location_id_fkey"
            columns: ["organization_id", "location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      ai_signals: {
        Row: {
          created_at: string
          dedupe_key: string
          facts: Json
          id: string
          location_id: string | null
          observed_at: string
          organization_id: string
          rule_version: string
          severity: string
          signal_type: string
          source_entity_id: string | null
          source_entity_type: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          dedupe_key: string
          facts?: Json
          id?: string
          location_id?: string | null
          observed_at?: string
          organization_id: string
          rule_version: string
          severity: string
          signal_type: string
          source_entity_id?: string | null
          source_entity_type?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          dedupe_key?: string
          facts?: Json
          id?: string
          location_id?: string | null
          observed_at?: string
          organization_id?: string
          rule_version?: string
          severity?: string
          signal_type?: string
          source_entity_id?: string | null
          source_entity_type?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_signals_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_signals_organization_id_location_id_fkey"
            columns: ["organization_id", "location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_user_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          metadata: Json
          organization_id: string | null
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          metadata?: Json
          organization_id?: string | null
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          metadata?: Json
          organization_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_kpi_snapshots: {
        Row: {
          average_ticket: number
          cancellation_count: number
          covers: number
          generated_at: string
          id: string
          location_id: string | null
          metadata: Json
          new_leads: number
          no_show_count: number
          order_count: number
          organization_id: string
          reservation_count: number
          revenue: number
          snapshot_date: string
          unanswered_leads: number
        }
        Insert: {
          average_ticket?: number
          cancellation_count?: number
          covers?: number
          generated_at?: string
          id?: string
          location_id?: string | null
          metadata?: Json
          new_leads?: number
          no_show_count?: number
          order_count?: number
          organization_id: string
          reservation_count?: number
          revenue?: number
          snapshot_date: string
          unanswered_leads?: number
        }
        Update: {
          average_ticket?: number
          cancellation_count?: number
          covers?: number
          generated_at?: string
          id?: string
          location_id?: string | null
          metadata?: Json
          new_leads?: number
          no_show_count?: number
          order_count?: number
          organization_id?: string
          reservation_count?: number
          revenue?: number
          snapshot_date?: string
          unanswered_leads?: number
        }
        Relationships: [
          {
            foreignKeyName: "daily_kpi_snapshots_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_kpi_snapshots_organization_id_location_id_fkey"
            columns: ["organization_id", "location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      leads: {
        Row: {
          budget: number | null
          contact_name: string
          created_at: string
          email: string | null
          guest_count: number | null
          id: string
          lead_type: string
          location_id: string | null
          message: string | null
          organization_id: string
          owner_user_id: string | null
          phone: string
          requested_date: string | null
          source: string
          status: string
          updated_at: string
        }
        Insert: {
          budget?: number | null
          contact_name: string
          created_at?: string
          email?: string | null
          guest_count?: number | null
          id?: string
          lead_type: string
          location_id?: string | null
          message?: string | null
          organization_id: string
          owner_user_id?: string | null
          phone: string
          requested_date?: string | null
          source: string
          status?: string
          updated_at?: string
        }
        Update: {
          budget?: number | null
          contact_name?: string
          created_at?: string
          email?: string | null
          guest_count?: number | null
          id?: string
          lead_type?: string
          location_id?: string | null
          message?: string | null
          organization_id?: string
          owner_user_id?: string | null
          phone?: string
          requested_date?: string | null
          source?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      locations: {
        Row: {
          created_at: string
          currency: string
          id: string
          is_primary: boolean
          name: string
          organization_id: string
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string
          id?: string
          is_primary?: boolean
          name: string
          organization_id: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          id?: string
          is_primary?: boolean
          name?: string
          organization_id?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "locations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      membership_roles: {
        Row: {
          created_at: string
          id: string
          membership_id: string
          organization_id: string
          role_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          membership_id: string
          organization_id: string
          role_id: string
        }
        Update: {
          created_at?: string
          id?: string
          membership_id?: string
          organization_id?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "membership_roles_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "membership_roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "membership_roles_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          created_at: string
          id: string
          item_name: string
          item_sku: string | null
          line_total: number | null
          metadata: Json
          order_id: string
          organization_id: string
          quantity: number
          unit_price: number
        }
        Insert: {
          created_at?: string
          id?: string
          item_name: string
          item_sku?: string | null
          line_total?: number | null
          metadata?: Json
          order_id: string
          organization_id: string
          quantity: number
          unit_price: number
        }
        Update: {
          created_at?: string
          id?: string
          item_name?: string
          item_sku?: string | null
          line_total?: number | null
          metadata?: Json
          order_id?: string
          organization_id?: string
          quantity?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_organization_id_order_id_fkey"
            columns: ["organization_id", "order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      orders: {
        Row: {
          channel: string
          created_at: string
          currency: string
          customer_name: string
          delivery_fee: number
          discount_total: number
          fulfillment_type: string
          id: string
          lead_id: string | null
          location_id: string
          notes: string | null
          order_number: string
          organization_id: string
          payment_status: string
          phone: string | null
          requested_for: string | null
          reservation_id: string | null
          status: string
          subtotal: number
          tax_total: number
          total: number
          updated_at: string
        }
        Insert: {
          channel: string
          created_at?: string
          currency?: string
          customer_name: string
          delivery_fee?: number
          discount_total?: number
          fulfillment_type: string
          id?: string
          lead_id?: string | null
          location_id: string
          notes?: string | null
          order_number: string
          organization_id: string
          payment_status?: string
          phone?: string | null
          requested_for?: string | null
          reservation_id?: string | null
          status?: string
          subtotal?: number
          tax_total?: number
          total?: number
          updated_at?: string
        }
        Update: {
          channel?: string
          created_at?: string
          currency?: string
          customer_name?: string
          delivery_fee?: number
          discount_total?: number
          fulfillment_type?: string
          id?: string
          lead_id?: string | null
          location_id?: string
          notes?: string | null
          order_number?: string
          organization_id?: string
          payment_status?: string
          phone?: string | null
          requested_for?: string | null
          reservation_id?: string | null
          status?: string
          subtotal?: number
          tax_total?: number
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_organization_id_lead_id_fkey"
            columns: ["organization_id", "lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "orders_organization_id_location_id_fkey"
            columns: ["organization_id", "location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "orders_organization_id_reservation_id_fkey"
            columns: ["organization_id", "reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      organization_branding: {
        Row: {
          accent_color: string
          border_radius: string
          logo_initials: string
          logo_url: string | null
          organization_id: string
          primary_color: string
          theme_mode: string
          updated_at: string
        }
        Insert: {
          accent_color?: string
          border_radius?: string
          logo_initials?: string
          logo_url?: string | null
          organization_id: string
          primary_color?: string
          theme_mode?: string
          updated_at?: string
        }
        Update: {
          accent_color?: string
          border_radius?: string
          logo_initials?: string
          logo_url?: string | null
          organization_id?: string
          primary_color?: string
          theme_mode?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_branding_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_memberships: {
        Row: {
          created_at: string
          id: string
          invited_by: string | null
          organization_id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          invited_by?: string | null
          organization_id: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          invited_by?: string | null
          organization_id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_settings: {
        Row: {
          ai_manager_name: string
          currency: string
          dashboard_widgets: Json
          locale: string
          organization_id: string
          product_kpi_label: string
          product_kpi_unit: string | null
          service_status: string
          timezone: string
          updated_at: string
        }
        Insert: {
          ai_manager_name?: string
          currency?: string
          dashboard_widgets?: Json
          locale?: string
          organization_id: string
          product_kpi_label?: string
          product_kpi_unit?: string | null
          service_status?: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          ai_manager_name?: string
          currency?: string
          dashboard_widgets?: Json
          locale?: string
          organization_id?: string
          product_kpi_label?: string
          product_kpi_unit?: string | null
          service_status?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          business_type: string
          created_at: string
          id: string
          name: string
          slug: string
          status: string
          updated_at: string
        }
        Insert: {
          business_type?: string
          created_at?: string
          id?: string
          name: string
          slug: string
          status?: string
          updated_at?: string
        }
        Update: {
          business_type?: string
          created_at?: string
          id?: string
          name?: string
          slug?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      permissions: {
        Row: {
          created_at: string
          description: string
          id: string
          key: string
        }
        Insert: {
          created_at?: string
          description?: string
          id?: string
          key: string
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          key?: string
        }
        Relationships: []
      }
      platform_admins: {
        Row: {
          created_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      reservations: {
        Row: {
          assigned_user_id: string | null
          confirmation_code: string
          created_at: string
          duration_minutes: number
          email: string | null
          guest_name: string
          id: string
          lead_id: string | null
          location_id: string
          notes: string | null
          occasion: string | null
          organization_id: string
          party_size: number
          phone: string
          reservation_at: string
          source: string
          status: string
          updated_at: string
        }
        Insert: {
          assigned_user_id?: string | null
          confirmation_code: string
          created_at?: string
          duration_minutes?: number
          email?: string | null
          guest_name: string
          id?: string
          lead_id?: string | null
          location_id: string
          notes?: string | null
          occasion?: string | null
          organization_id: string
          party_size: number
          phone: string
          reservation_at: string
          source: string
          status?: string
          updated_at?: string
        }
        Update: {
          assigned_user_id?: string | null
          confirmation_code?: string
          created_at?: string
          duration_minutes?: number
          email?: string | null
          guest_name?: string
          id?: string
          lead_id?: string | null
          location_id?: string
          notes?: string | null
          occasion?: string | null
          organization_id?: string
          party_size?: number
          phone?: string
          reservation_at?: string
          source?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reservations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_organization_id_lead_id_fkey"
            columns: ["organization_id", "lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "reservations_organization_id_location_id_fkey"
            columns: ["organization_id", "location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          permission_id: string
          role_id: string
        }
        Insert: {
          permission_id: string
          role_id: string
        }
        Update: {
          permission_id?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_id_fkey"
            columns: ["permission_id"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          created_at: string
          description: string
          id: string
          is_platform_role: boolean
          key: string
          name: string
        }
        Insert: {
          created_at?: string
          description?: string
          id?: string
          is_platform_role?: boolean
          key: string
          name: string
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          is_platform_role?: boolean
          key?: string
          name?: string
        }
        Relationships: []
      }
      status_transitions: {
        Row: {
          from_status: string
          machine: string
          to_status: string
        }
        Insert: {
          from_status: string
          machine: string
          to_status: string
        }
        Update: {
          from_status?: string
          machine?: string
          to_status?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_ai_evaluation: {
        Args: {
          p_as_of: string
          p_intents: Json
          p_location_id: string
          p_organization_id: string
          p_rule_version: string
        }
        Returns: Json
      }
      approve_ai_recommendation: {
        Args: { p_approval_id: string; p_expected_version: number }
        Returns: {
          created_at: string
          decided_at: string | null
          decided_by_user_id: string | null
          expires_at: string | null
          id: string
          organization_id: string
          payload_hash_at_decision: string | null
          reason: string | null
          recommendation_id: string
          status: string
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "ai_approvals"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      begin_ai_recommendation_execution: {
        Args: { p_recommendation_id: string }
        Returns: {
          action_schema_version: string
          created_at: string
          dedupe_key: string
          executive_summary: string
          expected_benefit: string | null
          expires_at: string | null
          id: string
          location_id: string | null
          organization_id: string
          payload_hash: string | null
          priority_score: number
          recommendation_type: string
          recommended_action_payload: Json
          recommended_action_type: string
          requires_approval: boolean
          risk_level: string
          rule_id: string
          rule_version: string
          severity: string
          status: string
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "ai_recommendations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      calculate_daily_kpi_snapshot: {
        Args: {
          p_location_id?: string
          p_organization_id: string
          p_snapshot_date?: string
        }
        Returns: {
          average_ticket: number
          cancellation_count: number
          covers: number
          generated_at: string
          id: string
          location_id: string | null
          metadata: Json
          new_leads: number
          no_show_count: number
          order_count: number
          organization_id: string
          reservation_count: number
          revenue: number
          snapshot_date: string
          unanswered_leads: number
        }
        SetofOptions: {
          from: "*"
          to: "daily_kpi_snapshots"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      dismiss_ai_recommendation: {
        Args: { p_recommendation_id: string }
        Returns: {
          action_schema_version: string
          created_at: string
          dedupe_key: string
          executive_summary: string
          expected_benefit: string | null
          expires_at: string | null
          id: string
          location_id: string | null
          organization_id: string
          payload_hash: string | null
          priority_score: number
          recommendation_type: string
          recommended_action_payload: Json
          recommended_action_type: string
          requires_approval: boolean
          risk_level: string
          rule_id: string
          rule_version: string
          severity: string
          status: string
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "ai_recommendations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_ai_evaluation_facts: {
        Args: {
          p_as_of?: string
          p_location_id?: string
          p_organization_id: string
        }
        Returns: Json
      }
      get_dashboard_snapshot: {
        Args: { p_as_of?: string; p_organization_id: string }
        Returns: Json
      }
      get_my_permissions: {
        Args: { p_organization_id: string }
        Returns: string[]
      }
      get_my_role_names: {
        Args: { p_organization_id: string }
        Returns: string[]
      }
      get_organization_summary: {
        Args: { p_slug: string }
        Returns: {
          id: string
          name: string
          slug: string
        }[]
      }
      has_permission: {
        Args: { p_organization_id: string; p_permission_key: string }
        Returns: boolean
      }
      is_org_member: { Args: { p_organization_id: string }; Returns: boolean }
      recalculate_order_totals: {
        Args: { p_order_id: string }
        Returns: undefined
      }
      record_ai_action_attempt: {
        Args: {
          p_duration_ms?: number
          p_error_code?: string
          p_error_message?: string
          p_recommendation_id: string
          p_result_detail?: Json
          p_result_status: string
        }
        Returns: {
          action_payload: Json
          action_type: string
          actor_user_id: string | null
          approval_id: string | null
          attempted_at: string
          duration_ms: number | null
          error_code: string | null
          error_message: string | null
          id: string
          organization_id: string
          payload_hash: string
          recommendation_id: string
          result_detail: Json
          result_status: string
        }
        SetofOptions: {
          from: "*"
          to: "ai_action_attempts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_ai_outcome: {
        Args: {
          p_action_attempt_id: string
          p_after_snapshot?: Json
          p_before_snapshot?: Json
          p_failure_code?: string
          p_failure_message?: string
          p_human_notes?: string
          p_outcome_metrics?: Json
          p_recommendation_id: string
          p_status: string
        }
        Returns: {
          action_attempt_id: string | null
          after_snapshot: Json
          before_snapshot: Json
          created_at: string
          failure_code: string | null
          failure_message: string | null
          human_notes: string | null
          id: string
          measured_at: string | null
          organization_id: string
          outcome_metrics: Json
          recommendation_id: string
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "ai_outcomes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_audit_event: {
        Args: {
          p_action: string
          p_entity_id?: string
          p_entity_type: string
          p_metadata?: Json
          p_organization_id: string
        }
        Returns: string
      }
      reject_ai_recommendation: {
        Args: {
          p_approval_id: string
          p_expected_version: number
          p_reason: string
        }
        Returns: {
          created_at: string
          decided_at: string | null
          decided_by_user_id: string | null
          expires_at: string | null
          id: string
          organization_id: string
          payload_hash_at_decision: string | null
          reason: string | null
          recommendation_id: string
          status: string
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "ai_approvals"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

