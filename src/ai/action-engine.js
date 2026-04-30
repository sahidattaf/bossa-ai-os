export function generateActions(decisions) {
  return decisions.map(decision => ({
    title: decision,
    priority: "high"
  }));
}