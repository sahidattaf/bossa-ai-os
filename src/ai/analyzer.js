import { SCORING_RULES } from './scoring-rules.js';

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function addAlert(alerts, ruleKey, detail) {
  const rule = SCORING_RULES[ruleKey];

  alerts.push({
    key: ruleKey,
    text: rule.label,
    detail,
    score: rule.score,
    owner: rule.owner
  });
}

export function analyzeKPIs(data = {}) {
  const alerts = [];
  const kpis = data.kpis || {};

  const revenue = toNumber(kpis.revenue);
  const targetRevenue = toNumber(kpis.targetRevenue);
  const covers = toNumber(kpis.covers);
  const targetCovers = toNumber(kpis.targetCovers);
  const openDecisions = toNumber(data.openDecisions);
  const highSignals = (data.signals || []).filter(signal => String(signal.tag).toLowerCase() === 'high');

  if (targetRevenue > 0 && revenue < targetRevenue) {
    addAlert(alerts, 'revenueBelowTarget', `${revenue} vs target ${targetRevenue}`);
  }

  if (targetCovers > 0 && covers < targetCovers) {
    addAlert(alerts, 'coversBelowTarget', `${covers} covers vs target ${targetCovers}`);
  }

  if (String(data.promoPressure).toLowerCase() === 'high') {
    addAlert(alerts, 'promoPressureHigh', 'Promo pressure is marked High');
  }

  if (openDecisions >= 2) {
    addAlert(alerts, 'openDecisionsHigh', `${openDecisions} open decisions`);
  }

  if (highSignals.length) {
    addAlert(alerts, 'competitorSignalHigh', `${highSignals.length} high-priority signal(s)`);
  }

  if (!alerts.length) {
    return [{
      key: 'clear',
      text: 'No urgent KPI risks detected',
      detail: 'Keep weekly review rhythm',
      score: 0,
      owner: 'BossVisionGPT'
    }];
  }

  return alerts.sort((a, b) => b.score - a.score);
}
