const GOOGLE_APPS_SCRIPT_WEB_APP_URL = window.BOSSA_GOOGLE_APPS_SCRIPT_WEB_APP_URL || '';
const FALLBACK_DATA_URL = './data.json';

const WEEKLY_BRIEF_FALLBACKS = {
  biggestMovement: 'Weekend value offer pulling price-sensitive traffic',
  recommendedMove: 'Protect brand, test value bundle, avoid direct discounting'
};

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

function hasValue(value) {
  return value !== undefined && value !== null && value !== '';
}

function isZeroValue(value) {
  return value === 0 || cleanValue(value) === '0';
}

function pickRawValue(source, keys) {
  for (const key of keys) {
    if (hasValue(source[key])) {
      return source[key];
    }
  }

  return '';
}

function pickValue(source, keys) {
  return cleanValue(pickRawValue(source, keys));
}

function splitTextRows(value) {
  if (Array.isArray(value)) {
    return value.flatMap(item => splitTextRows(item));
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

function expandRows(value, textKeys) {
  return splitTextRows(value).flatMap(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      return [row];
    }

    const textValue = pickRawValue(row, textKeys);
    const hasOnlyTextPayload = textValue && textKeys.some(key => hasValue(row[key])) &&
      Object.values(row).filter(hasValue).length === 1;

    if (typeof textValue === 'string' && (textValue.includes('\n') || textValue.includes('\t')) && hasOnlyTextPayload) {
      return splitTextRows(textValue);
    }

    return [row];
  });
}

function objectFromAliases(row, fields, defaults, aliases) {
  return fields.reduce((item, field) => {
    item[field] = pickValue(row, aliases[field] || [field]) || defaults[field];
    return item;
  }, {});
}

function normalizeTabularRows(value, fields, defaults, aliases = {}) {
  const textKeys = aliases.text || [fields[0]];

  return expandRows(value, textKeys)
    .map(row => {
      if (row && typeof row === 'object' && !Array.isArray(row)) {
        return objectFromAliases(row, fields, defaults, aliases);
      }

      const columns = splitColumns(row);
      return fields.reduce((item, field, index) => {
        item[field] = columns[index] || defaults[field];
        return item;
      }, {});
    })
    .filter(item => item.text);
}

function normalizeSignals(value) {
  return normalizeTabularRows(
    value,
    ['text', 'tag', 'owner', 'status'],
    DEFAULTS.signal,
    {
      text: ['text', 'signal', 'Signal', 'description', 'Description'],
      tag: ['tag', 'priority', 'Priority'],
      owner: ['owner', 'Owner'],
      status: ['status', 'Status']
    }
  );
}

function parseDecisionLine(row) {
  const line = cleanValue(row);
  const match = line.match(/^(.*?)\s+(Ops Manager|Chef|Marketing Team|Analyst|AI Operator)\s+(Open|Pending|Done|In Progress)\s+(\d{4}-\d{2}-\d{2})$/i);

  if (!match) {
    const columns = splitColumns(row);
    return {
      text: columns[0] || line || DEFAULTS.decision.text,
      owner: columns[1] || DEFAULTS.decision.owner,
      status: columns[2] || DEFAULTS.decision.status,
      decisionDate: columns[3] || DEFAULTS.decision.decisionDate
    };
  }

  return {
    text: cleanValue(match[1]),
    owner: cleanValue(match[2]),
    status: cleanValue(match[3]),
    decisionDate: cleanValue(match[4])
  };
}

function normalizeDecisions(value) {
  return expandRows(value, ['text', 'decision', 'Decision', 'description', 'Description'])
    .map(row => {
      if (row && typeof row === 'object' && !Array.isArray(row)) {
        return objectFromAliases(
          row,
          ['text', 'owner', 'status', 'decisionDate'],
          DEFAULTS.decision,
          {
            text: ['text', 'decision', 'Decision', 'description', 'Description'],
            owner: ['owner', 'Owner'],
            status: ['status', 'Status'],
            decisionDate: ['decisionDate', 'decision date', 'Decision Date', 'date', 'Date']
          }
        );
      }

      return parseDecisionLine(row);
    })
    .filter(item => item.text);
}

function parseActionLine(row) {
  const line = cleanValue(row);
  const match = line.match(/^(.*?)\s+(Marketing Team|Analyst|AI Operator|Ops Manager|Chef)\s+(High|Medium|Low|Watch)\s+(In Progress|Open|Pending|Done)\s+(\d{4}-\d{2}-\d{2})$/i);

  if (!match) {
    const columns = splitColumns(row);
    return {
      text: columns[0] || line || DEFAULTS.action.text,
      owner: columns[1] || DEFAULTS.action.owner,
      priority: columns[2] || DEFAULTS.action.priority,
      status: columns[3] || DEFAULTS.action.status,
      dueDate: columns[4] || DEFAULTS.action.dueDate
    };
  }

  return {
    text: cleanValue(match[1]),
    owner: cleanValue(match[2]),
    priority: cleanValue(match[3]),
    status: cleanValue(match[4]),
    dueDate: cleanValue(match[5])
  };
}

function normalizeActions(value) {
  return expandRows(value, ['text', 'action', 'Action', 'title', 'Title'])
    .map(row => {
      if (row && typeof row === 'object' && !Array.isArray(row)) {
        return objectFromAliases(
          row,
          ['text', 'owner', 'priority', 'status', 'dueDate'],
          DEFAULTS.action,
          {
            text: ['text', 'action', 'Action', 'title', 'Title'],
            owner: ['owner', 'Owner'],
            priority: ['priority', 'Priority'],
            status: ['status', 'Status'],
            dueDate: ['dueDate', 'due date', 'Due Date', 'date', 'Date']
          }
        );
      }

      return parseActionLine(row);
    })
    .filter(item => item.text);
}

function normalizeWeeklyBrief(value) {
  const brief = value && typeof value === 'object' && !Array.isArray(value)
    ? {
        topThreat: pickValue(value, ['topThreat', 'top threat', 'Top Threat']) || DEFAULTS.weeklyBrief.topThreat,
        biggestMovement: pickRawValue(value, ['biggestMovement', 'biggest movement', 'Biggest Movement']),
        recommendedMove: pickRawValue(value, ['recommendedMove', 'recommended move', 'Recommended Move'])
      }
    : (() => {
        const columns = splitTextRows(value).flatMap(splitColumns);
        return {
          topThreat: columns[0] || DEFAULTS.weeklyBrief.topThreat,
          biggestMovement: columns[1] || DEFAULTS.weeklyBrief.biggestMovement,
          recommendedMove: columns[2] || DEFAULTS.weeklyBrief.recommendedMove
        };
      })();

  return {
    topThreat: cleanValue(brief.topThreat),
    biggestMovement: isZeroValue(brief.biggestMovement)
      ? WEEKLY_BRIEF_FALLBACKS.biggestMovement
      : cleanValue(brief.biggestMovement) || DEFAULTS.weeklyBrief.biggestMovement,
    recommendedMove: isZeroValue(brief.recommendedMove)
      ? WEEKLY_BRIEF_FALLBACKS.recommendedMove
      : cleanValue(brief.recommendedMove) || DEFAULTS.weeklyBrief.recommendedMove
  };
}

export function normalizeBossaData(rawData = {}) {
  const source = rawData.data && typeof rawData.data === 'object'
    ? rawData.data
    : rawData;

  return {
    ...source,
    weeklyBrief: normalizeWeeklyBrief(source.weeklyBrief),
    signals: normalizeSignals(source.signals),
    decisions: normalizeDecisions(source.decisions),
    actions: normalizeActions(source.actions)
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
