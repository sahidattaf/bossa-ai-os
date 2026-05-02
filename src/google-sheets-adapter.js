const GOOGLE_APPS_SCRIPT_WEB_APP_URL = window.BOSSA_GOOGLE_APPS_SCRIPT_WEB_APP_URL || '';
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

function cleanValue(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function pickValue(source, keys) {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null && source[key] !== '') {
      return cleanValue(source[key]);
    }
  }

  return '';
}

function splitRows(value) {
  if (Array.isArray(value)) {
    return value.flatMap(item => splitRows(item));
  }

  if (typeof value === 'string') {
    return value
      .split(/\r?\n/)
      .map(row => row.trim())
      .filter(Boolean);
  }

  if (value && typeof value === 'object') {
    return [value];
  }

  return [];
}

function splitColumns(row) {
  return String(row)
    .split('\t')
    .map(value => cleanValue(value))
    .filter(Boolean);
}

function normalizeList(value, fields, defaults, aliases = {}) {
  return splitRows(value)
    .map(row => {
      if (row && typeof row === 'object' && !Array.isArray(row)) {
        return fields.reduce((item, field) => {
          item[field] = pickValue(row, aliases[field] || [field]) || defaults[field];
          return item;
        }, {});
      }

      const columns = splitColumns(row);
      return fields.reduce((item, field, index) => {
        item[field] = columns[index] || defaults[field];
        return item;
      }, {});
    })
    .filter(item => item.text || item.topThreat || item.biggestMovement || item.recommendedMove);
}

function normalizeWeeklyBrief(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return {
      topThreat: pickValue(value, ['topThreat', 'top threat', 'Top Threat']) || DEFAULTS.weeklyBrief.topThreat,
      biggestMovement: pickValue(value, ['biggestMovement', 'biggest movement', 'Biggest Movement']) || DEFAULTS.weeklyBrief.biggestMovement,
      recommendedMove: pickValue(value, ['recommendedMove', 'recommended move', 'Recommended Move']) || DEFAULTS.weeklyBrief.recommendedMove
    };
  }

  const columns = splitRows(value).flatMap(splitColumns);
  return {
    topThreat: columns[0] || DEFAULTS.weeklyBrief.topThreat,
    biggestMovement: columns[1] || DEFAULTS.weeklyBrief.biggestMovement,
    recommendedMove: columns[2] || DEFAULTS.weeklyBrief.recommendedMove
  };
}

export function normalizeBossaData(rawData = {}) {
  const source = rawData.data && typeof rawData.data === 'object'
    ? rawData.data
    : rawData;

  return {
    ...source,
    weeklyBrief: normalizeWeeklyBrief(source.weeklyBrief),
    signals: normalizeList(
      source.signals,
      ['text', 'tag', 'owner', 'status'],
      DEFAULTS.signal,
      {
        text: ['text', 'signal', 'Signal', 'description', 'Description'],
        tag: ['tag', 'priority', 'Priority'],
        owner: ['owner', 'Owner'],
        status: ['status', 'Status']
      }
    ),
    decisions: normalizeList(
      source.decisions,
      ['text', 'owner', 'status', 'decisionDate'],
      DEFAULTS.decision,
      {
        text: ['text', 'decision', 'Decision', 'description', 'Description'],
        owner: ['owner', 'Owner'],
        status: ['status', 'Status'],
        decisionDate: ['decisionDate', 'decision date', 'Decision Date', 'date', 'Date']
      }
    ),
    actions: normalizeList(
      source.actions,
      ['text', 'owner', 'priority', 'status', 'dueDate'],
      DEFAULTS.action,
      {
        text: ['text', 'action', 'Action', 'title', 'Title'],
        owner: ['owner', 'Owner'],
        priority: ['priority', 'Priority'],
        status: ['status', 'Status'],
        dueDate: ['dueDate', 'due date', 'Due Date', 'date', 'Date']
      }
    )
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
    if (!GOOGLE_APPS_SCRIPT_WEB_APP_URL) {
      throw new Error('Google Apps Script URL is not configured.');
    }

    const response = await fetch(GOOGLE_APPS_SCRIPT_WEB_APP_URL);
    if (!response.ok) {
      throw new Error(`Google Apps Script request failed: ${response.status}`);
    }

    return normalizeBossaData(await response.json());
  } catch (error) {
    console.warn('Using fallback BOSSA data.', error);
    return loadFallbackData();
  }
}
