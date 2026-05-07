const FALLBACK_DATA_URL = './data.json';

const DEFAULTS = {
  signal: {
    text: '',
    tag: 'Watch',
    owner: 'Unassigned',
    status: 'Monitor'
  },
  decision: {
    text: '',
    owner: 'Unassigned',
    status: 'Open',
    decisionDate: ''
  },
  action: {
    text: '',
    owner: 'Unassigned',
    priority: 'Medium',
    status: 'Open',
    dueDate: ''
  },
  weeklyBrief: {
    topThreat: '',
    biggestMovement: '',
    recommendedMove: ''
  }
};

function getLiveDataUrl() {
  return window.BOSSA_CONFIG?.GOOGLE_APPS_SCRIPT_WEB_APP_URL || '';
}

function cleanValue(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function hasValue(value) {
  return value !== undefined && value !== null && value !== '';
}

function formatDate(date) {
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function normalizeLastUpdated(value) {
  if (typeof value === 'number') {
    if (value > 1000000000000) return formatDate(new Date(value));
    if (value > 1000000000) return formatDate(new Date(value * 1000));

    const sheetsEpoch = Date.UTC(1899, 11, 30);
    return formatDate(new Date(sheetsEpoch + value * 86400000));
  }

  return cleanValue(value);
}

function pickValue(source, keys, fallback = '') {
  for (const key of keys) {
    if (hasValue(source?.[key])) return cleanValue(source[key]);
  }

  return fallback;
}

function normalizeArray(value, defaults) {
  if (!Array.isArray(value)) return [];

  return value.map(item => ({
    ...defaults,
    ...(item || {})
  })).filter(item => item.text);
}

export function normalizeBossaData(rawData = {}) {
  const source = rawData.data && typeof rawData.data === 'object'
    ? rawData.data
    : rawData;

  return {
    ...source,
    weekOf: cleanValue(source.weekOf),
    lastUpdated: normalizeLastUpdated(source.lastUpdated),
    topThreat: cleanValue(source.topThreat),
    promoPressure: cleanValue(source.promoPressure),
    pricingActions: cleanValue(source.pricingActions),
    openDecisions: cleanValue(source.openDecisions),
    bossSummary: cleanValue(source.bossSummary),
    kpis: source.kpis || {},
    signals: normalizeArray(source.signals, DEFAULTS.signal),
    decisions: normalizeArray(source.decisions, DEFAULTS.decision),
    actions: normalizeArray(source.actions, DEFAULTS.action),
    weeklyBrief: {
      topThreat: pickValue(source.weeklyBrief, ['topThreat'], DEFAULTS.weeklyBrief.topThreat),
      biggestMovement: pickValue(source.weeklyBrief, ['biggestMovement'], DEFAULTS.weeklyBrief.biggestMovement),
      recommendedMove: pickValue(source.weeklyBrief, ['recommendedMove'], DEFAULTS.weeklyBrief.recommendedMove)
    }
  };
}

async function loadFallbackData() {
  const response = await fetch(FALLBACK_DATA_URL);
  if (!response.ok) {
    throw new Error(`Fallback data request failed: ${response.status}`);
  }

  return normalizeBossaData(await response.json());
}

export default async function loadBossaData() {
  try {
    const liveDataUrl = getLiveDataUrl();

    if (!liveDataUrl) {
      throw new Error('Live data URL is not configured.');
    }

    const response = await fetch(liveDataUrl);
    if (!response.ok) {
      throw new Error(`Live data request failed: ${response.status}`);
    }

    return normalizeBossaData(await response.json());
  } catch (error) {
    console.warn('Using fallback BOSSA data.', error);
    return loadFallbackData();
  }
}
