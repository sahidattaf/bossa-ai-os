import loadBossaData from './adapters/google-sheets-adapter.js';
import { analyzeKPIs } from './ai/analyzer.js';
import { generateDecisions } from './ai/decision-engine.js';
import { generateActions } from './ai/action-engine.js';

const setText = (id, value) => {
  const el = document.getElementById(id);
  if (el) el.textContent = value ?? '';
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

function renderAIDecisions(decisions = []) {
  const aiDecisions = document.getElementById('aiDecisions');
  if (!aiDecisions) return;

  aiDecisions.innerHTML = '';

  decisions.forEach(decision => {
    const div = document.createElement('div');
    div.className = 'item';
    div.innerHTML = `
      ${decision.text}
      <div class="meta">
        ${decision.owner} • ${decision.sourceAlert || 'Weekly review'}
        <span class="badge ${getPriorityClass(decision.priority)}">${decision.priority}</span>
      </div>
    `;
    aiDecisions.appendChild(div);
  });
}

function getPriorityClass(priority = '') {
  const normalized = priority.toLowerCase();
  if (normalized === 'high') return 'badge-high';
  if (normalized === 'medium') return 'badge-medium';
  return 'badge-low';
}

function getStatusClass(status = '') {
  const normalized = status.toLowerCase();
  if (normalized === 'active') return 'badge-active';
  if (normalized === 'review') return 'badge-review';
  if (normalized === 'in progress') return 'badge-progress';
  if (normalized === 'open') return 'badge-open';
  return 'badge-monitor';
}

function renderSignals(data) {
  const signalsList = document.getElementById('signalsList');
  if (!signalsList) return;

  signalsList.innerHTML = '';
  data.signals.forEach(signal => {
    const div = document.createElement('div');
    div.className = 'item';
    div.innerHTML = `
      ${signal.text}
      <span class="badge ${getPriorityClass(signal.tag)}">${signal.tag}</span>
      <div class="meta">
        ${signal.owner}
        <span class="badge ${getStatusClass(signal.status)}">${signal.status}</span>
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
    const div = document.createElement('div');
    div.className = 'item';
    div.innerHTML = `
      ${d.text}
      <div class="meta">
        ${d.owner} • ${d.decisionDate}
        <span class="badge ${getStatusClass(d.status)}">${d.status}</span>
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
    ? actions.filter(a => String(a.priority).toLowerCase() === 'high')
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
      const dueDate = new Date(a.dueDate);
      const isOverdue = dueDate < today && String(a.status).toLowerCase() !== 'done';

      const div = document.createElement('div');
      div.className = 'item action executive-focus';
      div.innerHTML = `
        ${a.text || a.title}
        <div class="meta ${isOverdue ? 'overdue-text' : ''}">
          Due: ${a.dueDate || 'TBD'}
          <span class="badge ${getPriorityClass(a.priority)}">${a.priority}</span>
          <span class="badge ${getStatusClass(a.status)}">${a.status}</span>
          ${isOverdue ? '<span class="badge badge-overdue">Overdue</span>' : ''}
        </div>
      `;
      actionsList.appendChild(div);
    });
  });
}

async function loadDashboard() {
  const data = await loadBossaData();
  const executiveModeToggle = document.getElementById('executiveModeToggle');
  const alerts = analyzeKPIs(data);
  const aiDecisions = generateDecisions(alerts);
  const aiActions = generateActions(aiDecisions);
  const actions = data.actions?.length ? data.actions : aiActions;

  renderMeta(data);
  renderKPIs(data);
  renderSignals(data);
  renderBrief(data);
  renderDecisions(data);
  renderAIDecisions(aiDecisions);

  if (executiveModeToggle) {
    const renderDashboardActions = () => {
      renderActions(actions, {
        highPriorityOnly: executiveModeToggle.checked
      });
    };

    renderDashboardActions();
    executiveModeToggle.addEventListener('change', renderDashboardActions);
    return;
  }

  renderActions(actions, { highPriorityOnly: false });
}

loadDashboard();
