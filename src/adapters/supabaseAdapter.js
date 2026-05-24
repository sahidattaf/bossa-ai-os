// BOSSA AI OS Supabase Adapter
// Works with the current static dashboard architecture.
// Requires the Supabase browser SDK to be loaded before this file:
// <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//
// Security note:
// The fallback publishable key is a public browser key. It is only paired with
// read-only RLS policies for non-PII dashboard tables. Customer/PII tables stay blocked.

(function initBossaSupabaseAdapter(globalScope) {
  const config = globalScope.BOSSA_CONFIG || {};

  const DEFAULT_SUPABASE_URL = "https://oqmftkttkfktyzefswpz.supabase.co";
  const DEFAULT_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_kvP4TK0pxuj7A3nW_7fgjg_SouElsbH";

  const SUPABASE_URL = config.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const SUPABASE_PUBLISHABLE_KEY = config.SUPABASE_PUBLISHABLE_KEY || DEFAULT_SUPABASE_PUBLISHABLE_KEY;

  function isConfigured() {
    return Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
  }

  function getClient() {
    if (!isConfigured()) {
      throw new Error("Supabase is not configured. Add SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY to src/config.js.");
    }

    if (!globalScope.supabase || typeof globalScope.supabase.createClient !== "function") {
      throw new Error("Supabase SDK is not loaded. Add @supabase/supabase-js browser script before supabaseAdapter.js.");
    }

    if (!globalScope.__BOSSA_SUPABASE_CLIENT__) {
      globalScope.__BOSSA_SUPABASE_CLIENT__ = globalScope.supabase.createClient(
        SUPABASE_URL,
        SUPABASE_PUBLISHABLE_KEY
      );
    }

    return globalScope.__BOSSA_SUPABASE_CLIENT__;
  }

  async function listRows(table, options = {}) {
    const { limit = 50, orderBy = "created_at", ascending = false } = options;
    const client = getClient();

    const { data, error } = await client
      .from(table)
      .select("*")
      .order(orderBy, { ascending })
      .limit(limit);

    if (error) {
      throw new Error(`Supabase listRows failed for ${table}: ${error.message}`);
    }

    return data || [];
  }

  async function insertRow(table, payload) {
    const client = getClient();

    const { data, error } = await client
      .from(table)
      .insert(payload)
      .select()
      .single();

    if (error) {
      throw new Error(`Supabase insertRow failed for ${table}: ${error.message}`);
    }

    return data;
  }

  async function upsertDailyKpi(payload) {
    const client = getClient();

    if (!payload || !payload.date) {
      throw new Error("upsertDailyKpi requires a payload with a date field.");
    }

    const { data, error } = await client
      .from("kpi_daily")
      .upsert(payload, { onConflict: "date" })
      .select()
      .single();

    if (error) {
      throw new Error(`Supabase upsertDailyKpi failed: ${error.message}`);
    }

    return data;
  }

  async function logDecision(payload) {
    return insertRow("decision_log", payload);
  }

  async function logAgentRun(payload) {
    return insertRow("agent_runs", payload);
  }

  globalScope.BossaSupabaseAdapter = {
    isConfigured,
    getClient,
    listRows,
    insertRow,
    upsertDailyKpi,
    logDecision,
    logAgentRun,
    tables: {
      campaigns: "campaigns",
      contentItems: "content_items",
      whatsappLeads: "whatsapp_leads",
      orders: "orders",
      bookings: "bookings",
      menuItems: "menu_items",
      kpiDaily: "kpi_daily",
      decisionLog: "decision_log",
      weeklyBriefs: "weekly_briefs",
      agentRuns: "agent_runs",
      usersProfiles: "users_profiles"
    }
  };
})(globalThis);
