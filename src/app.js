const signalsList = document.getElementById('signalsList');
if (signalsList) {
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
}const decisionsList = document.getElementById('decisionsList');
if (decisionsList) {
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
}const actionsList = document.getElementById('actionsList');
if (actionsList) {
  actionsList.innerHTML = '';
  const today = new Date();

  const grouped = {};
  data.actions.forEach(a => {
    if (!grouped[a.owner]) grouped[a.owner] = [];
    grouped[a.owner].push(a);
  });

  Object.entries(grouped).forEach(([owner, actions]) => {
    const ownerHeader = document.createElement('div');
    ownerHeader.className = 'owner-group';
    ownerHeader.textContent = owner;
    actionsList.appendChild(ownerHeader);

    actions.forEach(a => {
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
      div.className = 'item action';
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
    const statusClass =
      a.status.toLowerCase() === 'in progress' ? 'badge-progress' :
      a.status.toLowerCase() === 'open' ? 'badge-open' :
      'badge-pending';

    const div = document.createElement('div');
    div.className = 'item action';
    div.innerHTML = `
      ${a.text}
      <div class="meta">
        ${a.owner} • Due: ${a.dueDate}
        <span class="badge ${priorityClass}">${a.priority}</span>
        <span class="badge ${statusClass}">${a.status}</span>
      </div>
    `;
    actionsList.appendChild(div);
  });
}