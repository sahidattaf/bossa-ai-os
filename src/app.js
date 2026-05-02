import loadBossaData from './google-sheets-adapter.js';
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
}

function renderKPIs(data) {
  setText('topThreat', data.topThreat);
  setText('promoPressure', data.promoPressure);
  setText('pricingActions', data.pricingActions);
  setText('openDecisions', data.openDecisions);
}

function renderSummary(data) {
  setText('bossSummary', data.bossSummary);
}

function renderSignals(signals = []) {
  const el = document.getElementById('signalsList');
  if (!el) return;

  el.innerHTML = signals.map(s => `
    <div>
      <strong class="${s.tag.toLowerCase()}">${s.text}</strong><br/>
      <small>${s.tag} — ${s.owner}</small>
    </div>
  `).join('');
}

function renderDecisions(decisions = []) {
  const el = document.getElementById('decisionsList');
  if (!el) return;

  el.innerHTML = decisions.map(d => `
    <div>
      <strong>${d.text}</strong><br/>
      <small>${d.status} — ${d.owner}</small>
    </div>
  `).join('');
}

function renderBrief(data) {
  const el = document.getElementById('briefBox');
  if (!el || !data.weeklyBrief) return;

  const b = data.weeklyBrief;

  el.innerHTML = `
    <p><strong>Top:</strong> ${b.topThreat}</p>
    <p><strong>Move:</strong> ${b.biggestMovement}</p>
    <p><strong>Action:</strong> ${b.recommendedMove}</p>
  `;
}

function renderAIDecisions(list = []) {
  const el = document.getElementById('aiDecisions');
  if (!el) return;

  el.innerHTML = list.map(d => `
    <div>
      🧠 ${d}
    </div>
  `).join('');
}

function renderActions(actions = []) {
  const el = document.getElementById('actionsList');
  if (!el) return;

  el.innerHTML = actions.map(a => `
    <div>
      <strong>${a.title || a.text}</strong><br/>
      <small>${a.priority}</small>
    </div>
  `).join('');
}

function applySavedInput(data) {
  const savedInput = JSON.parse(localStorage.getItem('bossaDailyInput') || '{}');
  const nextData = {
    ...data,
    kpis: { ...(data.kpis || {}) },
    signals: [...(data.signals || [])]
  };

  if (savedInput.revenue) nextData.kpis.revenue = savedInput.revenue;
  if (savedInput.covers) nextData.kpis.covers = savedInput.covers;

  if (savedInput.issue) {
    nextData.bossSummary = `${nextData.bossSummary} Today's issue: ${savedInput.issue}.`;
  }

  if (savedInput.competitor) {
    nextData.signals.unshift({
      text: savedInput.competitor,
      tag: savedInput.priority || 'High',
      owner: 'Owner Input',
      status: 'Active'
    });
  }

  const noteEl = document.getElementById('lastInputNote');
  if (noteEl && savedInput.date) {
    noteEl.textContent = `Last input: ${savedInput.date} • Priority: ${savedInput.priority || 'High'}`;
  }

  return nextData;
}

async function loadDashboard() {
  let data = await loadBossaData();

  data = applySavedInput(data);

  renderMeta(data);
  renderKPIs(data);
  renderSummary(data);
  renderSignals(data.signals);
  renderDecisions(data.decisions);
  renderBrief(data);

  const alerts = analyzeKPIs(data);
  const aiDecisions = generateDecisions(alerts);
  const aiActions = generateActions(aiDecisions);
  const actions = data.actions?.length ? data.actions : aiActions;

  renderAIDecisions(aiDecisions);
  renderActions(actions);
}

loadDashboard();
