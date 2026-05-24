const saveButton = document.getElementById('saveInput');
const clearButton = document.getElementById('clearInput');
const saveStatus = document.getElementById('saveStatus');
const authStatus = document.getElementById('authStatus');

const sendMagicLinkButton = document.getElementById('sendMagicLink');
const signOutButton = document.getElementById('signOutOperator');
const saveKpiButton = document.getElementById('saveKpi');
const saveDecisionButton = document.getElementById('saveDecision');
const saveBriefButton = document.getElementById('saveBrief');

function getValue(id) {
  return document.getElementById(id)?.value?.trim() || '';
}

function getNumber(id) {
  const value = Number(document.getElementById(id)?.value || 0);
  return Number.isFinite(value) ? value : 0;
}

function setStatus(message, type = 'info') {
  if (!authStatus) return;
  authStatus.textContent = message;
  authStatus.className = type;
}

function requireSupabase() {
  if (!globalThis.BossaSupabaseAdapter?.isConfigured?.()) {
    throw new Error('Supabase is not configured.');
  }

  return globalThis.BossaSupabaseAdapter.getClient();
}

async function getSession() {
  const client = requireSupabase();
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  return data.session;
}

async function refreshAuthStatus() {
  try {
    const session = await getSession();
    if (session?.user?.email) {
      setStatus(`Signed in as ${session.user.email}. Supabase writes are enabled for approved operators.`, 'success');
      return session;
    }

    setStatus('Not signed in. Enter your approved operator email and send a magic link.', 'warning');
    return null;
  } catch (error) {
    setStatus(`Auth check failed: ${error.message}`, 'error');
    return null;
  }
}

async function ensureSignedIn() {
  const session = await refreshAuthStatus();
  if (!session) {
    throw new Error('Please sign in first with the approved BOSSA operator email.');
  }
  return session;
}

async function sendMagicLink() {
  try {
    const email = getValue('operatorEmail');
    if (!email) throw new Error('Enter your email first.');

    const client = requireSupabase();
    const { error } = await client.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: window.location.href
      }
    });

    if (error) throw error;
    setStatus(`Magic link sent to ${email}. Open it in this browser to activate writing.`, 'success');
  } catch (error) {
    setStatus(`Magic link failed: ${error.message}`, 'error');
  }
}

async function signOutOperator() {
  try {
    const client = requireSupabase();
    const { error } = await client.auth.signOut();
    if (error) throw error;
    setStatus('Signed out.', 'info');
  } catch (error) {
    setStatus(`Sign out failed: ${error.message}`, 'error');
  }
}

async function saveKpiToSupabase() {
  try {
    await ensureSignedIn();

    const date = getValue('date') || new Date().toISOString().slice(0, 10);
    const payload = {
      date,
      revenue: getNumber('revenue'),
      bookings: getNumber('covers'),
      orders: getNumber('orders'),
      whatsapp_inquiries: getNumber('whatsappInquiries'),
      posts_published: getNumber('postsPublished'),
      reach: getNumber('reach'),
      notes: getValue('issue')
    };

    await globalThis.BossaSupabaseAdapter.upsertDailyKpi(payload);
    setStatus(`KPI saved for ${date}. Refresh Dashboard to see it live.`, 'success');
  } catch (error) {
    setStatus(`KPI save failed: ${error.message}`, 'error');
  }
}

async function saveDecisionToSupabase() {
  try {
    await ensureSignedIn();

    const decision = getValue('decisionText');
    if (!decision) throw new Error('Decision text is required.');

    await globalThis.BossaSupabaseAdapter.insertRow('decision_log', {
      decision,
      reason: getValue('decisionReason'),
      expected_result: getValue('expectedResult'),
      owner: getValue('decisionOwner') || 'BOSSA AI OS',
      status: getValue('decisionStatus') || 'active',
      decision_date: new Date().toISOString().slice(0, 10)
    });

    setStatus('Decision saved to Supabase. Refresh Dashboard to see it live.', 'success');
  } catch (error) {
    setStatus(`Decision save failed: ${error.message}`, 'error');
  }
}

async function saveWeeklyBriefToSupabase() {
  try {
    await ensureSignedIn();

    const weekStart = getValue('weekStart');
    const weekEnd = getValue('weekEnd');
    if (!weekStart || !weekEnd) throw new Error('Week start and week end are required.');

    await globalThis.BossaSupabaseAdapter.insertRow('weekly_briefs', {
      week_start: weekStart,
      week_end: weekEnd,
      summary: getValue('briefSummary'),
      opportunities: getValue('briefOpportunities'),
      risks: getValue('briefRisks'),
      next_actions: getValue('briefNextActions')
    });

    setStatus('Weekly brief saved to Supabase. Refresh Dashboard to see it live.', 'success');
  } catch (error) {
    setStatus(`Weekly brief save failed: ${error.message}`, 'error');
  }
}

function loadSavedInput() {
  const saved = JSON.parse(localStorage.getItem('bossaDailyInput') || '{}');

  document.getElementById('date').value = saved.date || new Date().toISOString().slice(0, 10);
  document.getElementById('revenue').value = saved.revenue || '';
  document.getElementById('covers').value = saved.covers || '';
  document.getElementById('issue').value = saved.issue || '';
  document.getElementById('competitor').value = saved.competitor || '';
  document.getElementById('priority').value = saved.priority || 'High';

  const today = new Date();
  const weekEnd = new Date(today);
  weekEnd.setDate(today.getDate() + 6);
  document.getElementById('weekStart').value ||= today.toISOString().slice(0, 10);
  document.getElementById('weekEnd').value ||= weekEnd.toISOString().slice(0, 10);
}

saveButton.addEventListener('click', () => {
  const input = {
    date: getValue('date'),
    revenue: getNumber('revenue'),
    covers: getNumber('covers'),
    issue: getValue('issue'),
    competitor: getValue('competitor'),
    priority: getValue('priority')
  };

  localStorage.setItem('bossaDailyInput', JSON.stringify(input));
  const now = new Date().toLocaleTimeString();
  saveStatus.textContent = `Saved local backup at ${now} ✅`;
});

clearButton.addEventListener('click', () => {
  localStorage.removeItem('bossaDailyInput');
  saveStatus.textContent = 'Local backup cleared.';
  loadSavedInput();
});

sendMagicLinkButton.addEventListener('click', sendMagicLink);
signOutButton.addEventListener('click', signOutOperator);
saveKpiButton.addEventListener('click', saveKpiToSupabase);
saveDecisionButton.addEventListener('click', saveDecisionToSupabase);
saveBriefButton.addEventListener('click', saveWeeklyBriefToSupabase);

loadSavedInput();
refreshAuthStatus();
