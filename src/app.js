const signalsList = document.getElementById('signalsList');
if (signalsList) {
  signalsList.innerHTML = '';
  data.signals.forEach(signal => {
    const div = document.createElement('div');
    div.className = 'item';
    div.innerHTML = `
      ${signal.text} 
      <span class="tag">${signal.tag}</span>
      <div class="meta">${signal.owner} • ${signal.status}</div>
    `;
    signalsList.appendChild(div);
  });
}const decisionsList = document.getElementById('decisionsList');
if (decisionsList) {
  decisionsList.innerHTML = '';
  data.decisions.forEach(d => {
    const div = document.createElement('div');
    div.className = 'item';
    div.innerHTML = `
      ${d.text}
      <div class="meta">${d.owner} • ${d.status} • ${d.decisionDate}</div>
    `;
    decisionsList.appendChild(div);
  });
}
const decisionsList = document.getElementById('decisionsList');
if (decisionsList) {
  decisionsList.innerHTML = '';
  data.decisions.forEach(d => {
    const div = document.createElement('div');
    div.className = 'item';
    div.innerHTML = `
      ${d.text}
      <div class="meta">${d.owner} • ${d.status} • ${d.decisionDate}</div>
    `;
    decisionsList.appendChild(div);
  });
}const actionsList = document.getElementById('actionsList');
if (actionsList) {
  actionsList.innerHTML = '';
  data.actions.forEach(a => {
    const div = document.createElement('div');
    div.className = 'item action';
    div.innerHTML = `
      ${a.text}
      <div class="meta">${a.owner} • ${a.priority} • ${a.status} • Due: ${a.dueDate}</div>
    `;
    actionsList.appendChild(div);
  });
}