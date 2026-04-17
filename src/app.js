async function loadDashboard() {
  const response = await fetch('./data.json');
  const data = await response.json();

  // KPI
  document.getElementById('topThreat').textContent = data.topThreat;
  document.getElementById('promoPressure').textContent = data.promoPressure;
  document.getElementById('pricingActions').textContent = data.pricingActions;
  document.getElementById('openDecisions').textContent = data.openDecisions;

  // Meta
  document.getElementById('weekOf').textContent = data.weekOf;
  document.getElementById('lastUpdated').textContent = data.lastUpdated;

  // Boss summary
  document.getElementById('bossSummary').textContent = data.bossSummary;

  // Signals
  const signalsList = document.getElementById('signalsList');
  data.signals.forEach(signal => {
    const div = document.createElement('div');
    div.className = 'item';
    div.innerHTML = `${signal.text} <span class="tag">${signal.tag}</span>`;
    signalsList.appendChild(div);
  });

  // Weekly brief
  document.getElementById('briefBox').innerHTML = `
    <div class="item">Top threat: ${data.weeklyBrief.topThreat}</div>
    <div class="item">Biggest movement: ${data.weeklyBrief.biggestMovement}</div>
    <div class="item">Recommended move: ${data.weeklyBrief.recommendedMove}</div>
  `;

  // Decisions
  const decisionsList = document.getElementById('decisionsList');
  data.decisions.forEach(d => {
    const div = document.createElement('div');
    div.className = 'item';
    div.textContent = d;
    decisionsList.appendChild(div);
  });

  // Actions
  const actionsList = document.getElementById('actionsList');
  data.actions.forEach(a => {
    const div = document.createElement('div');
    div.className = 'item action';
    div.textContent = a;
    actionsList.appendChild(div);
  });
}

loadDashboard();