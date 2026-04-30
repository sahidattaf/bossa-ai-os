export function analyzeKPIs(data) {
  const alerts = [];
  const kpis = data.kpis || {};

  const revenue = kpis.revenue ?? 0;
  const targetRevenue = kpis.targetRevenue ?? 0;
  const covers = kpis.covers ?? 0;
  const targetCovers = kpis.targetCovers ?? 0;

  if (targetRevenue > 0 && revenue < targetRevenue) {
    alerts.push("Revenue below target");
  }

  if (targetCovers > 0 && covers < targetCovers) {
    alerts.push("Low traffic detected");
  }

  if (!alerts.length) {
    alerts.push("No urgent KPI risks detected");
  }

  return alerts;
}