import loadBossaData from './google-sheets-adapter.js';
import { analyzeKPIs } from './ai/analyzer.js';
import { generateDecisions } from './ai/decision-engine.js';
import { generateActions } from './ai/action-engine.js';

const WEEKLY_BRIEF_FALLBACKS = {
  biggestMovement: 'Weekend value offer pulling price-sensitive traffic',
  recommendedMove: 'Protect brand, test value bundle, avoid direct discounting'
};

const setText = (id, value) => {
  const el = document.getElementById(id);
  if (el) el.textContent = value ?? '';
};

function displayValue(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized && normalized !== '0' ? normalized : fallback;
}

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
    <div class="item">
      <strong class="${String(s.tag || '').toLowerCase()}">${displayValue(s.text)}</strong><br/>
      <small>${displayValue(s.tag, 'Watch')} — ${displayValue(s.owner, 'Unassigned')} — ${displayValue(s.status, 'Monitor')}</small>
    </div>
  `).join('');
}

function renderDecisions(decisions = []) {
  const el = document.getElementById('decisionsList');
  if (!el) return;

  el.innerHTML = decisions.map(d => `
    <div class="item">
      <strong>${displayValue(d.text)}</strong><br/>
      <small>${displayValue(d.status, 'Open')} — ${displayValue(d.owner, 'Unassigned')} — ${displayValue(d.decisionDate)}</small>
    </div>
  `).join('');
}

function renderBrief(data) {
  const el = document.getElementById('briefBox');
  if (!el || !data.weeklyBrief) return;

  const b = data.weeklyBrief;

  el.innerHTML = `
    <div class="item"><strong>Top:</strong> ${displayValue(b.topThreat)}</div>
    <div class="item"><strong>Move:</strong> ${displayValue(b.biggestMovement, WEEKLY_BRIEF_FALLBACKS.biggestMovement)}</div>
    <div class="item"><strong>Action:</strong> ${displayValue(b.recommendedMove, WEEKLY_BRIEF_FALLBACKS.recommendedMove)}</div>
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
    <div class="item action">
      <strong>${displayValue(a.title || a.text)}</strong><br/>
      <small>${displayValue(a.priority, 'Medium')} — ${displayValue(a.owner, 'Unassigned')} — ${displayValue(a.status, 'Open')} — ${displayValue(a.dueDate)}</small>
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
