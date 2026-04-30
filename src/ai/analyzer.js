export function analyzeKPIs(data) {
  const alerts = [];

  if (data.kpis.revenue < data.kpis.targetRevenue) {
    alerts.push("Revenue below target");
  }

  if (data.kpis.covers < data.kpis.targetCovers) {
    alerts.push("Low traffic detected");
  }

  return alerts;
}