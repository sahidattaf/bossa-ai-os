export function generateDecisions(alerts) {
  const decisions = [];

  alerts.forEach(alert => {
    if (alert.includes("Revenue")) {
      decisions.push("Test value bundle instead of discounting");
    }

    if (alert.includes("traffic")) {
      decisions.push("Launch weekday offer campaign");
    }
  });

  return decisions;
}