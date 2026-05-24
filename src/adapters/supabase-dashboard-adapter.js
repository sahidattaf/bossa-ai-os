import { normalizeBossaData } from './google-sheets-adapter.js';

const RECENT_LIMIT = 5;

function hasSupabaseAdapter() {
  return Boolean(globalThis.BossaSupabaseAdapter?.isConfigured?.());
}

function formatWeekLabel(brief) {
  if (!brief?.week_start) return '';
  return brief.week_end ? `${brief.week_start} → ${brief.week_end}` : brief.week_start;
}

function formatDate(value) {
  return value ? String(value).slice(0, 10) : '';
}

function decisionStatusCounts(decisions = []) {
  const openStatuses = new Set(['active', 'open', 'pending', 'in progress']);
  return decisions.filter((decision) => openStatuses.has(String(decision.status || '').toLowerCase())).length;
}

function mapCampaignSignal(campaign) {
  return {
    text: campaign.offer || campaign.name,
    tag: campaign.status || 'Watch',
    owner: campaign.platform || 'MarketingGPT',
    status: campaign.goal || 'Monitor'
  };
}

function mapDecision(decision) {
  return {
    text: decision.decision,
    owner: decision.owner || 'DecisionGPT',
    status: decision.status || 'Open',
    decisionDate: formatDate(decision.decision_date)
  };
}

function mapBrief(brief, latestKpi, decisions = [], campaigns = []) {
  const topCampaign = campaigns[0];

  return {
    topThreat: brief?.risks || topCampaign?.name || 'No major threat logged',
    biggestMovement: brief?.opportunities || (latestKpi ? `Revenue ${latestKpi.revenue || 0} • Orders ${latestKpi.orders || 0}` : ''),
    recommendedMove: brief?.next_actions || decisions[0]?.expected_result || 'Review dashboard data and log next decision'
  };
}

function buildBossSummary(brief, latestKpi, decisions = []) {
  if (brief?.summary) return brief.summary;

  if (latestKpi) {
    return `Live Supabase data loaded. Revenue: ${latestKpi.revenue || 0}, bookings: ${latestKpi.bookings || 0}, orders: ${latestKpi.orders || 0}, WhatsApp inquiries: ${latestKpi.whatsapp_inquiries || 0}.`;
  }

  if (decisions.length) {
    return `Live Supabase decisions loaded. ${decisionStatusCounts(decisions)} decisions still need attention.`;
  }

  return 'Supabase is connected, but no live dashboard rows are available yet.';
}

async function safeList(table, options) {
  try {
    return await globalThis.BossaSupabaseAdapter.listRows(table, options);
  } catch (error) {
    console.warn(`Supabase dashboard read skipped for ${table}.`, error);
    return [];
  }
}

export async function loadSupabaseDashboardData() {
  if (!hasSupabaseAdapter()) {
    throw new Error('Supabase dashboard adapter is not configured.');
  }

  const tables = globalThis.BossaSupabaseAdapter.tables;

  const [kpis, decisions, briefs, campaigns] = await Promise.all([
    safeList(tables.kpiDaily, { limit: RECENT_LIMIT, orderBy: 'date', ascending: false }),
    safeList(tables.decisionLog, { limit: RECENT_LIMIT, orderBy: 'decision_date', ascending: false }),
    safeList(tables.weeklyBriefs, { limit: 1, orderBy: 'week_start', ascending: false }),
    safeList(tables.campaigns, { limit: RECENT_LIMIT, orderBy: 'created_at', ascending: false })
  ]);

  const latestKpi = kpis[0] || null;
  const latestBrief = briefs[0] || null;
  const mappedDecisions = decisions.map(mapDecision);
  const mappedSignals = campaigns.map(mapCampaignSignal);
  const openDecisionCount = decisionStatusCounts(decisions);

  return normalizeBossaData({
    weekOf: formatWeekLabel(latestBrief) || latestKpi?.date || 'Live Supabase',
    lastUpdated: formatDate(latestKpi?.updated_at || latestBrief?.updated_at || new Date().toISOString()),
    topThreat: latestBrief?.risks || campaigns[0]?.name || 'Watch',
    promoPressure: campaigns[0]?.status || 'Live',
    pricingActions: campaigns.length,
    openDecisions: openDecisionCount,
    bossSummary: buildBossSummary(latestBrief, latestKpi, decisions),
    kpis: {
      revenue: latestKpi?.revenue || 0,
      covers: latestKpi?.bookings || 0,
      orders: latestKpi?.orders || 0,
      whatsappInquiries: latestKpi?.whatsapp_inquiries || 0,
      postsPublished: latestKpi?.posts_published || 0,
      reach: latestKpi?.reach || 0
    },
    signals: mappedSignals,
    decisions: mappedDecisions,
    actions: mappedDecisions.slice(0, 3).map((decision) => ({
      text: `Follow up: ${decision.text}`,
      owner: decision.owner,
      priority: decision.status === 'active' ? 'High' : 'Medium',
      status: decision.status,
      dueDate: decision.decisionDate
    })),
    weeklyBrief: mapBrief(latestBrief, latestKpi, decisions, campaigns)
  });
}

export function canUseSupabaseDashboardData() {
  return hasSupabaseAdapter();
}
