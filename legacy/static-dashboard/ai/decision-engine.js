const DECISION_MAP = {
  revenueBelowTarget: 'Test one value bundle without discounting the core brand',
  coversBelowTarget: 'Launch weekday traffic campaign with clear reservation CTA',
  promoPressureHigh: 'Protect premium perception and compare competitor offers before reacting',
  openDecisionsHigh: 'Close or delegate open decisions before the next service window',
  competitorSignalHigh: 'Review competitor signal and decide whether to counter, ignore, or reposition',
  clear: 'Maintain rhythm and document what worked this week'
};

export function generateDecisions(alerts = []) {
  return alerts.map(alert => ({
    text: DECISION_MAP[alert.key] || alert.text,
    owner: alert.owner || 'BossVisionGPT',
    priority: alert.score >= 4 ? 'High' : alert.score >= 2 ? 'Medium' : 'Low',
    sourceAlert: alert.text,
    detail: alert.detail
  }));
}
