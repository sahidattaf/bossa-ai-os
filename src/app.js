async function loadDashboard() {
  const response = await fetch('./data.json');
  const data = await response.json();

  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };

  setText('topThreat', data.topThreat);
  setText('promoPressure', data.promoPressure);
  setText('pricingActions', data.pricingActions);
  setText('openDecisions', data.openDecisions);
  setText('weekOf', data.weekOf);
  setText('lastUpdated', data.lastUpdated);
  setText('bossSummary', data.bossSummary);

  const signalsList = document.getElementById('signalsList');
  if (signalsList) {
    signalsList.innerHTML = '';
    data.signals.forEach(signal => {
      const div = document.createElement('div');
      div.className = 'item';
      div.innerHTML = `${signal.text} <span class="tag">${signal.tag}</span>`;
      signalsList.appendChild(div);
    });
  }

  const briefBox = document.getElementById('briefBox');
  if (briefBox) {
    briefBox.innerHTML = `
      <div class="item">Top threat: ${data.weeklyBrief.topThreat}</div>
      <div class="item">Biggest movement: ${data.weeklyBrief.biggestMovement}</div>
      <div class="item">Recommended move: ${data.weeklyBrief.recommendedMove}</div>
    `;
  }

  const decisionsList = document.getElementById('decisionsList');
  if (decisionsList) {
    decisionsList.innerHTML = '';
    data.decisions.forEach(d => {
      const div = document.createElement('div');
      div.className = 'item';
      div.textContent = d;
      decisionsList.appendChild(div);
    });
  }

  const actionsList = document.getElementById('actionsList');
  if (actionsList) {
    actionsList.innerHTML = '';
    data.actions.forEach(a => {
      const div = document.createElement('div');
      div.className = 'item action';
      div.textContent = a;
      actionsList.appendChild(div);
    });
  }
}

loadDashboard();