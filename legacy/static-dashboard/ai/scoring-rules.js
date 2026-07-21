export const SCORING_RULES = {
  revenueBelowTarget: {
    score: 4,
    label: 'Revenue below target',
    owner: 'FinanceGPT'
  },
  coversBelowTarget: {
    score: 4,
    label: 'Covers below target',
    owner: 'ServiceFlowGPT'
  },
  promoPressureHigh: {
    score: 3,
    label: 'High promo pressure',
    owner: 'MarketingGPT'
  },
  openDecisionsHigh: {
    score: 2,
    label: 'Open decisions need closure',
    owner: 'BossVisionGPT'
  },
  competitorSignalHigh: {
    score: 3,
    label: 'Competitor signal needs review',
    owner: 'AnalyticsGPT'
  }
};

export function getPriorityFromScore(score) {
  if (score >= 4) return 'High';
  if (score >= 2) return 'Medium';
  return 'Low';
}
