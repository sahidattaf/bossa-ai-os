import { assertEquals, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { analyzeKPIs } from './analyzer.js';
import { generateDecisions } from './decision-engine.js';
import { generateActions } from './action-engine.js';

Deno.test('analyzeKPIs returns high priority alerts when targets are missed', () => {
  const alerts = analyzeKPIs({
    promoPressure: 'High',
    openDecisions: 2,
    kpis: {
      revenue: 45000,
      targetRevenue: 120000,
      covers: 65,
      targetCovers: 180
    },
    signals: [
      { text: 'Competitor promo', tag: 'High' }
    ]
  });

  assert(alerts.length >= 3);
  assertEquals(alerts[0].score, 4);
});

Deno.test('generateDecisions returns structured decision objects', () => {
  const decisions = generateDecisions([
    {
      key: 'revenueBelowTarget',
      text: 'Revenue below target',
      detail: '45000 vs target 120000',
      score: 4,
      owner: 'FinanceGPT'
    }
  ]);

  assertEquals(decisions.length, 1);
  assertEquals(decisions[0].owner, 'FinanceGPT');
  assertEquals(decisions[0].priority, 'High');
});

Deno.test('generateActions converts decisions into assigned actions', () => {
  const actions = generateActions([
    {
      text: 'Test one value bundle',
      owner: 'MarketingGPT',
      priority: 'High',
      sourceAlert: 'Revenue below target'
    }
  ]);

  assertEquals(actions.length, 1);
  assertEquals(actions[0].owner, 'MarketingGPT');
  assertEquals(actions[0].status, 'Open');
  assert(actions[0].dueDate.length === 10);
});
