const saveButton = document.getElementById('saveInput');
const clearButton = document.getElementById('clearInput');
const saveStatus = document.getElementById('saveStatus');
const authStatus = document.getElementById('authStatus');

const sendMagicLinkButton = document.getElementById('sendMagicLink');
const signOutButton = document.getElementById('signOutOperator');
const saveCampaignButton = document.getElementById('saveCampaign');
const saveContentItemButton = document.getElementById('saveContentItem');
const saveKpiButton = document.getElementById('saveKpi');
const saveDecisionButton = document.getElementById('saveDecision');
const saveBriefButton = document.getElementById('saveBrief');

const PRODUCTION_INPUT_URL = 'https://bossa-ai-os.vercel.app/input.html';

function getRedirectUrl() {
  const currentUrl = new URL(window.location.href);
  const isLocalhost = ['localhost', '127.0.0.1'].includes(currentUrl.hostname);
  const isProduction = currentUrl.hostname === 'bossa-ai-os.vercel.app';

  if (isProduction) {
    return `${currentUrl.origin}/input.html`;
  }

  if (isLocalhost) {
    return currentUrl.href.split('#')[0];
  }

  return PRODUCTION_INPUT_URL;
}

async function hydrateSessionFromHash() {
  const hash = window.location.hash;
  if (!hash || !hash.includes('access_token')) return false;

  const client = requireSupabase();
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');

  if (!accessToken || !refreshToken) return false;

  const { error } = await client.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken
  });

  if (error) throw error;

  window.history.replaceState({}, document.title, window.location.pathname);
  return true;
}

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
    const didHydrate = await hydrateSessionFromHash();
    const session = await getSession();
    if (session?.user?.email) {
      const prefix = didHydrate ? 'Magic link accepted. ' : '';
      setStatus(`${prefix}Signed in as ${session.user.email}. Supabase writes are enabled for approved operators.`, 'success');
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
        shouldCreateUser: false,
        emailRedirectTo: getRedirectUrl()
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

async function findCampaignByName(name) {
  if (!name) return null;
  const client = requireSupabase();
  const { data, error } = await client
    .from('campaigns')
    .select('id,name')
    .ilike('name', name)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function saveCampaignToSupabase() {
  try {
    await ensureSignedIn();

    const name = getValue('campaignName');
    if (!name) throw new Error('Campaign name is required.');

    await globalThis.BossaSupabaseAdapter.insertRow('campaigns', {
      name,
      offer: getValue('campaignOffer'),
      platform: getValue('campaignPlatform'),
      status: getValue('campaignStatus') || 'draft',
      start_date: getValue('campaignStartDate') || null,
      end_date: getValue('campaignEndDate') || null,
      goal: getValue('campaignGoal')
    });

    setStatus(`Campaign saved: ${name}. Refresh Dashboard to see it live.`, 'success');
  } catch (error) {
    setStatus(`Campaign save failed: ${error.message}`, 'error');
  }
}

async function saveContentItemToSupabase() {
  try {
    await ensureSignedIn();

    const title = getValue('contentTitle');
    if (!title) throw new Error('Content title is required.');

    const linkedCampaign = await findCampaignByName(getValue('contentCampaignName'));

    await globalThis.BossaSupabaseAdapter.insertRow('content_items', {
      campaign_id: linkedCampaign?.id || null,
      title,
      content_type: getValue('contentType'),
      platform: getValue('contentPlatform'),
      language: getValue('contentLanguage') || 'en',
      scheduled_date: getValue('contentScheduledDate') || null,
      scheduled_time: getValue('contentScheduledTime') || null,
      owner: getValue('contentOwner') || 'MarketingGPT',
      status: getValue('contentStatus') || 'draft',
      caption: getValue('contentCaption'),
      cta: getValue('contentCta'),
      asset_url: getValue('contentAssetUrl'),
      notes: getValue('contentNotes')
    });

    const linkText = linkedCampaign ? ` linked to ${linkedCampaign.name}` : ' as standalone content';
    setStatus(`Content item saved${linkText}.`, 'success');
  } catch (error) {
    setStatus(`Content save failed: ${error.message}`, 'error');
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
  document.getElementById('campaignStartDate').value ||= today.toISOString().slice(0, 10);
  document.getElementById('contentScheduledDate').value ||= today.toISOString().slice(0, 10);
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
saveCampaignButton.addEventListener('click', saveCampaignToSupabase);
saveContentItemButton.addEventListener('click', saveContentItemToSupabase);
saveKpiButton.addEventListener('click', saveKpiToSupabase);
saveDecisionButton.addEventListener('click', saveDecisionToSupabase);
saveBriefButton.addEventListener('click', saveWeeklyBriefToSupabase);

loadSavedInput();
refreshAuthStatus();
