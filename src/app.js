const setText = (id, value) => {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
};

function renderMeta(data) {
  setText('weekOf', data.weekOf);
  setText('lastUpdated', data.lastUpdated);
  setText('bossSummary', data.bossSummary);
}

function renderKPIs(data) {
  setText('topThreat', data.topThreat);
  setText('promoPressure', data.promoPressure);
  setText('pricingActions', data.pricingActions);
  setText('openDecisions', data.openDecisions);
}

function renderSignals(data) {
  const signalsList = document.getElementById('signalsList');
  if (!signalsList) return;

  signalsList.innerHTML = '';
  data.signals.forEach(signal => {
    const priorityClass =
      signal.tag.toLowerCase() === 'high' ? 'badge-high' :
      signal.tag.toLowerCase() === 'medium' ? 'badge-medium' :
      'badge-low';

    const statusClass =
      signal.status.toLowerCase() === 'active' ? 'badge-active' :
      signal.status.toLowerCase() === 'review' ? 'badge-review' :
      'badge-monitor';

    const div = document.createElement('div');
    div.className = 'item';
    div.innerHTML = `
      ${signal.text}
      <span class="badge ${priorityClass}">${signal.tag}</span>
      <div class="meta">
        ${signal.owner}
        <span class="badge ${statusClass}">${signal.status}</span>
      </div>
    `;
    signalsList.appendChild(div);
  });
}

function renderBrief(data) {
  const briefBox = document.getElementById('briefBox');
  if (!briefBox) return;

  briefBox.innerHTML = `
    <div class="item">Top threat: ${data.weeklyBrief.topThreat}</div>
    <div class="item">Biggest movement: ${data.weeklyBrief.biggestMovement}</div>
    <div class="item">Recommended move: ${data.weeklyBrief.recommendedMove}</div>
  `;
}

function renderDecisions(data) {
  const decisionsList = document.getElementById('decisionsList');
  if (!decisionsList) return;

  decisionsList.innerHTML = '';
  data.decisions.forEach(d => {
    const statusClass =
      d.status.toLowerCase() === 'open' ? 'badge-open' : 'badge-pending';

    const div = document.createElement('div');
    div.className = 'item';
    div.innerHTML = `
      ${d.text}
      <div class="meta">
        ${d.owner} • ${d.decisionDate}
        <span class="badge ${statusClass}">${d.status}</span>
      </div>
    `;
    decisionsList.appendChild(div);
  });
}

function renderActions(actions, options = {}) {
  const actionsList = document.getElementById('actionsList');
  if (!actionsList) return;

  const highPriorityOnly = options.highPriorityOnly || false;
  const filteredActions = highPriorityOnly
    ? actions.filter(a => a.priority.toLowerCase() === 'high')
    : actions;
  const grouped = {};
  const today = new Date();

  actionsList.innerHTML = '';

  filteredActions.forEach(a => {
    if (!grouped[a.owner]) grouped[a.owner] = [];
    grouped[a.owner].push(a);
  });

  Object.entries(grouped).forEach(([owner, ownerActions]) => {
    const ownerHeader = document.createElement('div');
    ownerHeader.className = 'owner-group';
    ownerHeader.textContent = owner;
    actionsList.appendChild(ownerHeader);

    ownerActions.forEach(a => {
      const priorityClass =
        a.priority.toLowerCase() === 'high' ? 'badge-high' :
        a.priority.toLowerCase() === 'medium' ? 'badge-medium' :
        'badge-low';

      const statusClass =
        a.status.toLowerCase() === 'in progress' ? 'badge-progress' :
        a.status.toLowerCase() === 'open' ? 'badge-open' :
        'badge-pending';

      const dueDate = new Date(a.dueDate);
      const isOverdue = dueDate < today && a.status.toLowerCase() !== 'done';

      const div = document.createElement('div');
      div.className = 'item action executive-focus';
      div.innerHTML = `
        ${a.text}
        <div class="meta ${isOverdue ? 'overdue-text' : ''}">
          Due: ${a.dueDate}
          <span class="badge ${priorityClass}">${a.priority}</span>
          <span class="badge ${statusClass}">${a.status}</span>
          ${isOverdue ? '<span class="badge badge-overdue">Overdue</span>' : ''}
        </div>
      `;
      actionsList.appendChild(div);
    });
  });
}

async function loadDashboard() {
  const response = await fetch('./data.json');
  const data = await response.json();
  const executiveModeToggle = document.getElementById('executiveModeToggle');

  renderMeta(data);
  renderKPIs(data);
  renderSignals(data);
  renderBrief(data);
  renderDecisions(data);

  if (executiveModeToggle) {
    const renderDashboardActions = () => {
      renderActions(data.actions, {
        highPriorityOnly: executiveModeToggle.checked
      });
    };

    renderDashboardActions();
    executiveModeToggle.addEventListener('change', renderDashboardActions);
    return;
  }

  renderActions(data.actions, { highPriorityOnly: false });
}

loadDashboard();
