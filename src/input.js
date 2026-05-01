const saveButton = document.getElementById('saveInput');
const clearButton = document.getElementById('clearInput');
const saveStatus = document.getElementById('saveStatus');

function loadSavedInput() {
  const saved = JSON.parse(localStorage.getItem('bossaDailyInput') || '{}');

  document.getElementById('date').value = saved.date || '';
  document.getElementById('revenue').value = saved.revenue || '';
  document.getElementById('covers').value = saved.covers || '';
  document.getElementById('issue').value = saved.issue || '';
  document.getElementById('competitor').value = saved.competitor || '';
  document.getElementById('priority').value = saved.priority || 'High';
}

saveButton.addEventListener('click', () => {
  const input = {
    date: document.getElementById('date').value,
    revenue: Number(document.getElementById('revenue').value),
    covers: Number(document.getElementById('covers').value),
    issue: document.getElementById('issue').value,
    competitor: document.getElementById('competitor').value,
    priority: document.getElementById('priority').value
  };

  localStorage.setItem('bossaDailyInput', JSON.stringify(input));
  const now = new Date().toLocaleTimeString();
saveStatus.textContent = `Saved at ${now} ✅`;
});

clearButton.addEventListener('click', () => {
  localStorage.removeItem('bossaDailyInput');
  saveStatus.textContent = 'Input cleared.';
  loadSavedInput();
});

loadSavedInput();