export function generateActions(decisions = []) {
  return decisions.map((decision, index) => ({
    text: decision.text,
    owner: decision.owner || 'BossVisionGPT',
    priority: decision.priority || 'Medium',
    status: 'Open',
    dueDate: getDueDate(index),
    sourceAlert: decision.sourceAlert,
    detail: decision.detail
  }));
}

function getDueDate(index) {
  const date = new Date();
  date.setDate(date.getDate() + Math.min(index + 1, 3));
  return date.toISOString().slice(0, 10);
}
