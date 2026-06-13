const API = (window.API_BASE || '') + '/api';
const POLL_MS = 3000;

let currentPage = 1;
let dlqPage     = 1;
let pollTimer   = null;
let isStale     = false;

function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelector(`[data-tab="${name}"]`).classList.add('active');
  document.getElementById(`panel-${name}`).classList.add('active');

  if (name === 'jobs')      loadJobs(1);
  if (name === 'dlq')       loadDLQ(1);
  if (name === 'dashboard') loadStats();
  if (name === 'benchmark') loadBenchmark();
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

async function apiFetch(path, opts = {}) {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function loadStats() {
  try {
    const stats = await apiFetch('/jobs/stats');
    document.getElementById('stat-pending').textContent    = stats.pending;
    document.getElementById('stat-processing').textContent = stats.processing;
    document.getElementById('stat-completed').textContent  = stats.completed;
    document.getElementById('stat-failed').textContent     = stats.failed;
    document.getElementById('stat-cancelled').textContent  = stats.cancelled;

    const total = Object.values(stats).reduce((a, b) => a + b, 0);
    document.getElementById('badge-jobs').textContent = total;

    try {
      const dlq = await apiFetch('/dlq?limit=1');
      const dlqCount = dlq.pagination.total;
      document.getElementById('badge-dlq').textContent = dlqCount;
    } catch (_) {}

    setLive(true);
    loadRecentJobs();
  } catch (err) {
    setLive(false);
    console.error('Stats load failed:', err);
  }
}

async function loadRecentJobs() {
  try {
    const data = await apiFetch('/jobs?limit=8');
    const tbody = document.getElementById('recent-jobs-body');
    if (!data.jobs.length) {
      tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><div class="empty-icon"></div>No jobs yet. <a href="#" onclick="switchTab('create')">Create one →</a></div></td></tr>`;
      return;
    }
    tbody.innerHTML = data.jobs.map(j => `
      <tr>
        <td class="td-id" title="${j._id}">${j._id.slice(0, 8)}…</td>
        <td class="td-type">${escHtml(j.type)}</td>
        <td><span class="prio prio-${j.priority}">${j.priority}</span></td>
        <td>${statusPill(j.status)}</td>
        <td><span class="retry-count ${j.retryCount > 0 ? 'has-retries' : ''}">${j.retryCount}/${j.maxRetries}</span></td>
        <td class="td-time">${relTime(j.createdAt)}</td>
      </tr>
    `).join('');
  } catch (_) {}
}

async function loadJobs(page = 1, preserveData = false) {
  currentPage = Math.max(1, page);
  const status   = document.getElementById('filter-status').value;
  const priority = document.getElementById('filter-priority').value;
  const params   = new URLSearchParams({ page: currentPage, limit: 15 });
  if (status)   params.set('status', status);
  if (priority) params.set('priority', priority);

  const tbody = document.getElementById('jobs-body');
  
  // Only show loading indicator on first load or page change
  if (!preserveData) {
    tbody.style.opacity = '0.5';
  }

  try {
    const data = await apiFetch('/jobs?' + params);
    
    if (!data.jobs.length) {
      tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state"><div class="empty-icon">📭</div>No jobs match this filter.</div></tr>`;
    } else if (preserveData && tbody.children.length > 0) {
      // Update existing rows without rebuilding entire table
      updateJobsTableIncremental(data.jobs, tbody);
    } else {
      tbody.innerHTML = data.jobs.map(j => jobRow(j)).join('');
    }

    const { total, page: p, pages, limit } = data.pagination;
    const from = (p - 1) * limit + 1;
    const to   = Math.min(p * limit, total);
    document.getElementById('jobs-pagination-info').textContent =
      total ? `${from}–${to} of ${total}` : '0 jobs';
    document.getElementById('jobs-prev').disabled = p <= 1;
    document.getElementById('jobs-next').disabled = p >= pages;
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state"><div class="empty-icon">⚠️</div>${escHtml(err.message)}</div></tr>`;
  } finally {
    tbody.style.opacity = '1';
  }
}

// NEW FUNCTION - Update only changed cells
function updateJobsTableIncremental(newJobs, tbody) {
  const existingRows = tbody.querySelectorAll('tr');
  
  newJobs.forEach((job, index) => {
    if (index < existingRows.length) {
      const row = existingRows[index];
      const rowId = row.cells[0].textContent;
      const newJobId = job._id.slice(0,8) + '…';
      
      // If same job ID, update only status and retry count
      if (rowId === newJobId) {
        updateJobRowCells(row, job);
      } else {
        // Different job, replace the whole row
        const newRow = createJobRowElement(job);
        row.parentNode.replaceChild(newRow, row);
      }
    } else {
      // Add new row
      tbody.appendChild(createJobRowElement(job));
    }
  });
  
  // Remove extra rows if fewer jobs than before
  while (tbody.children.length > newJobs.length) {
    tbody.removeChild(tbody.lastChild);
  }
}

// NEW FUNCTION - Update only status and retry cells
function updateJobRowCells(row, job) {
  // Update status cell (index 3)
  const statusCell = row.cells[3];
  const newStatusPill = statusPill(job.status);
  if (statusCell.innerHTML !== newStatusPill) {
    statusCell.innerHTML = newStatusPill;
  }
  
  // Update retry cell (index 4)
  const retryCell = row.cells[4];
  const newRetryText = `${job.retryCount}/${job.maxRetries}`;
  const currentRetryText = retryCell.textContent;
  if (currentRetryText !== newRetryText) {
    retryCell.innerHTML = `<span class="retry-count ${job.retryCount > 0 ? 'has-retries' : ''}">${newRetryText}</span>`;
  }
}

// NEW FUNCTION - Create a row element (not HTML string)
function createJobRowElement(job) {
  const row = document.createElement('tr');
  
  // ID cell
  const idCell = document.createElement('td');
  idCell.className = 'td-id';
  idCell.title = job._id;
  idCell.textContent = job._id.slice(0,8) + '…';
  row.appendChild(idCell);
  
  // Type cell
  const typeCell = document.createElement('td');
  typeCell.className = 'td-type';
  typeCell.textContent = escHtml(job.type);
  row.appendChild(typeCell);
  
  // Priority cell
  const prioCell = document.createElement('td');
  prioCell.innerHTML = `<span class="prio prio-${job.priority}">${job.priority}</span>`;
  row.appendChild(prioCell);
  
  // Status cell
  const statusCell = document.createElement('td');
  statusCell.innerHTML = statusPill(job.status);
  row.appendChild(statusCell);
  
  // Retry cell
  const retryCell = document.createElement('td');
  retryCell.innerHTML = `<span class="retry-count ${job.retryCount > 0 ? 'has-retries' : ''}">${job.retryCount}/${job.maxRetries}</span>`;
  row.appendChild(retryCell);
  
  // Scheduled cell
  const scheduledCell = document.createElement('td');
  scheduledCell.className = 'td-time';
  scheduledCell.textContent = job.scheduledAt ? fmtDate(job.scheduledAt) : '—';
  row.appendChild(scheduledCell);
  
  // Interval cell
  const intervalCell = document.createElement('td');
  intervalCell.className = 'td-time';
  intervalCell.style.color = 'var(--accent)';
  intervalCell.style.fontWeight = '700';
  intervalCell.textContent = job.recurringInterval ? job.recurringInterval.replace('every_','') : '—';
  row.appendChild(intervalCell);
  
  // Created cell
  const createdCell = document.createElement('td');
  createdCell.className = 'td-time';
  createdCell.textContent = relTime(job.createdAt);
  row.appendChild(createdCell);
  
  // Actions cell
  const actionsCell = document.createElement('td');
  if (!['completed','failed','cancelled'].includes(job.status)) {
    actionsCell.innerHTML = `<button class="btn btn-danger btn-sm" onclick="cancelJob('${job._id}')">Cancel</button>`;
  } else {
    actionsCell.innerHTML = '<span style="color:var(--text-dim);font-size:11px">—</span>';
  }
  row.appendChild(actionsCell);
  
  return row;
}

function jobRow(j) {
  const actions = [];
  if (!['completed','failed','cancelled'].includes(j.status)) {
    actions.push(`<button class="btn btn-danger btn-sm" onclick="cancelJob('${j._id}')">Cancel</button>`);
  }
  return `
    <tr>
      <td class="td-id" title="${j._id}">${j._id.slice(0,8)}…</td>
      <td class="td-type">${escHtml(j.type)}</td>
      <td><span class="prio prio-${j.priority}">${j.priority}</span></td>
      <td>${statusPill(j.status)}</td>
      <td><span class="retry-count ${j.retryCount > 0 ? 'has-retries' : ''}">${j.retryCount}/${j.maxRetries}</span></td>
      <td class="td-time">${j.scheduledAt ? fmtDate(j.scheduledAt) : '—'}</td>
      <td class="td-time" style="color:var(--accent);font-weight:700">${j.recurringInterval ? j.recurringInterval.replace('every_','') : '—'}</td>
      <td class="td-time">${relTime(j.createdAt)}</td>
      <td>${actions.join('') || '<span style="color:var(--text-dim);font-size:11px">—</span>'}</td>
    </tr>
  `;
}

async function cancelJob(id) {
  try {
    await apiFetch(`/jobs/${id}/cancel`, { method: 'PATCH' });
    toast('Job cancellation requested', 'info');
    loadJobs(currentPage);
    loadStats();
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function createJob() {
  const type     = document.getElementById('f-type').value.trim();
  const priority = parseInt(document.getElementById('f-priority').value);
  const payloadRaw = document.getElementById('f-payload').value.trim();
  const scheduledAt = document.getElementById('f-scheduled-at').value;
  const interval = document.getElementById('f-interval').value;
  const dependsRaw = document.getElementById('f-depends-on').value.trim();

  const result = document.getElementById('form-result');

  if (!type) { result.textContent = '⚠ type is required'; result.className = 'form-result err'; return; }

  let payload = {};
  if (payloadRaw) {
    try { payload = JSON.parse(payloadRaw); }
    catch { result.textContent = '⚠ payload is not valid JSON'; result.className = 'form-result err'; return; }
  }

  const dependsOn = dependsRaw
    ? dependsRaw.split(',').map(s => s.trim()).filter(Boolean)
    : [];

  const body = { type, priority, payload };
  if (scheduledAt) body.scheduledAt = new Date(scheduledAt).toISOString();
  if (interval)    body.recurringInterval = interval;
  if (dependsOn.length) body.dependsOn = dependsOn;

  try {
    const data = await apiFetch('/jobs', { method: 'POST', body: JSON.stringify(body) });
    result.textContent = `✓ Created ${data.job._id.slice(0,8)}…`;
    result.className = 'form-result ok';
    toast(`Job created: ${data.job._id.slice(0,8)}`, 'ok');
    loadStats();
    setTimeout(() => { result.textContent = ''; }, 4000);
  } catch (err) {
    result.textContent = `⚠ ${err.message}`;
    result.className = 'form-result err';
  }
}

function clearForm() {
  ['f-type','f-payload','f-scheduled-at','f-depends-on'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('f-priority').value = '2';
  document.getElementById('f-interval').value = '';
  document.getElementById('form-result').textContent = '';
}

async function createDAGDemo() {
  const result = document.getElementById('dag-result');
  result.textContent = 'Creating…';
  result.className = 'form-result';

  try {
    const j1 = await apiFetch('/jobs', {
      method: 'POST',
      body: JSON.stringify({
        type: 'send_email',
        priority: 1,
        payload: { to: 'report@dilamme.com', subject: '[STEP 1] Generate Report', body: 'Report generated.' },
      }),
    });

    const j2 = await apiFetch('/jobs', {
      method: 'POST',
      body: JSON.stringify({
        type: 'send_email',
        priority: 1,
        payload: { to: 'upload@dilamme.com', subject: '[STEP 2] Upload File', body: 'File uploaded.' },
        dependsOn: [j1.job._id],
      }),
    });

    const j3 = await apiFetch('/jobs', {
      method: 'POST',
      body: JSON.stringify({
        type: 'send_email',
        priority: 1,
        payload: { to: 'notify@dilamme.com', subject: '[STEP 3] Notify User', body: 'Pipeline complete.' },
        dependsOn: [j2.job._id],
      }),
    });

    result.textContent = `✓ 3 jobs created: ${j1.job._id.slice(0,8)} → ${j2.job._id.slice(0,8)} → ${j3.job._id.slice(0,8)}`;
    result.className = 'form-result ok';
    toast('DAG workflow created — watch the jobs tab!', 'ok');
    loadStats();
  } catch (err) {
    result.textContent = `⚠ ${err.message}`;
    result.className = 'form-result err';
  }
}

async function loadDLQ(page = 1, preserveData = false) {
  dlqPage = Math.max(1, page);
  const status = document.getElementById('filter-dlq-status').value;
  const params = new URLSearchParams({ page: dlqPage, limit: 10 });
  if (status) params.set('status', status);

  const list = document.getElementById('dlq-list');
  
  if (!preserveData) {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon"><div class="spinner"></div></div>Loading…</div>';
    list.style.opacity = '0.5';
  }

  try {
    const data = await apiFetch('/dlq?' + params);

    if (!data.entries.length) {
      list.innerHTML = `<div class="empty-state"><div class="empty-icon"></div>DLQ is empty${status ? ' for this filter' : ''}.</div>`;
    } else if (preserveData && list.children.length > 0) {
      // Update existing DLQ cards incrementally
      updateDLQIncremental(data.entries, list);
    } else {
      list.innerHTML = data.entries.map(e => dlqCard(e)).join('');
    }

    const { total, page: p, pages, limit } = data.pagination;
    const from = (p - 1) * limit + 1;
    const to   = Math.min(p * limit, total);
    document.getElementById('dlq-pagination-info').textContent =
      total ? `${from}–${to} of ${total}` : '0 entries';
    document.getElementById('dlq-prev').disabled = p <= 1;
    document.getElementById('dlq-next').disabled = p >= pages;
  } catch (err) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon"></div>${escHtml(err.message)}</div>`;
  } finally {
    list.style.opacity = '1';
  }
}

// NEW FUNCTION - Update DLQ incrementally
function updateDLQIncremental(newEntries, container) {
  const existingCards = container.querySelectorAll('.dlq-card');
  
  newEntries.forEach((entry, index) => {
    if (index < existingCards.length) {
      const card = existingCards[index];
      const cardId = card.querySelector('.dlq-job-id')?.textContent;
      
      // Update only status if same entry
      if (cardId === entry.jobId) {
        const statusSpan = card.querySelector('.pill');
        const statusColor = {
          waiting: 'var(--status-failed)',
          retrying: 'var(--status-processing)',
          resolved: 'var(--status-completed)',
          permanently_failed: 'var(--status-failed)',
        }[entry.dlqStatus] || 'var(--text-dim)';
        
        const statusBg = {
          waiting: '#FFCCCC',
          retrying: '#CCDDFF',
          resolved: '#CCFFE0',
          permanently_failed: '#FFCCCC',
        }[entry.dlqStatus] || '#E8E8E8';
        
        if (statusSpan) {
          statusSpan.style.background = statusBg;
          statusSpan.style.color = statusColor;
          statusSpan.innerHTML = `<span class="pill-dot" style="background:${statusColor}"></span>${entry.dlqStatus}`;
        }
      } else {
        // Replace card with new one
        const newCard = createDLQCardElement(entry);
        card.parentNode.replaceChild(newCard, card);
      }
    } else {
      // Add new card
      container.appendChild(createDLQCardElement(entry));
    }
  });
  
  // Remove extra cards
  while (container.children.length > newEntries.length) {
    container.removeChild(container.lastChild);
  }
}

// NEW FUNCTION - Create DLQ card element
function createDLQCardElement(e) {
  const statusColor = {
    waiting: 'var(--status-failed)',
    retrying: 'var(--status-processing)',
    resolved: 'var(--status-completed)',
    permanently_failed: 'var(--status-failed)',
  }[e.dlqStatus] || 'var(--text-dim)';

  const statusBg = {
    waiting: '#FFCCCC',
    retrying: '#CCDDFF',
    resolved: '#CCFFE0',
    permanently_failed: '#FFCCCC',
  }[e.dlqStatus] || '#E8E8E8';

  const canRetry = ['waiting','permanently_failed'].includes(e.dlqStatus);
  
  const div = document.createElement('div');
  div.className = 'dlq-card';
  div.id = `dlq-card-${e._id}`;
  div.innerHTML = `
    <div class="dlq-header" onclick="toggleDLQ('${e._id}')">
      <div class="dlq-header-left">
        <span class="prio prio-${e.priority || 2}">${e.priority || 2}</span>
        <div>
          <div class="dlq-job-type">${escHtml(e.jobType)}</div>
          <div class="dlq-job-id">${e.jobId}</div>
        </div>
        <div class="dlq-error-preview">${escHtml(e.errorMessage)}</div>
      </div>
      <div class="dlq-header-right">
        <span class="pill" style="background:${statusBg};color:${statusColor}">
          <span class="pill-dot" style="background:${statusColor}"></span>
          ${e.dlqStatus}
        </span>
        <span class="td-time">${relTime(e.createdAt)}</span>
        ${canRetry ? `<button class="btn btn-success btn-sm" onclick="event.stopPropagation(); retryDLQ('${e._id}')">↺ Retry</button>` : ''}
      </div>
    </div>
    <div class="dlq-body" id="dlq-body-${e._id}">
      <div class="dlq-section-label">Error</div>
      <div class="code-block">${escHtml(e.errorMessage)}</div>
      <div class="dlq-section-label">Stack Trace</div>
      <div class="code-block stack-trace">${escHtml(e.errorStack || 'No stack trace available.')}</div>
      <div class="dlq-section-label">Payload</div>
      <div class="code-block">${escHtml(JSON.stringify(e.payload, null, 2))}</div>
      <div style="display:flex;gap:16px;margin-top:14px;font-size:11px;font-family:var(--font-mono);color:var(--text-dim)">
        <span>Attempts: <strong style="color:var(--text)">${e.totalAttempts}</strong></span>
        <span>DLQ retries: <strong style="color:var(--text)">${e.retryCount}</strong></span>
        <span>Entered: <strong style="color:var(--text)">${fmtDate(e.createdAt)}</strong></span>
        ${e.lastRetriedAt ? `<span>Last retry: <strong style="color:var(--text)">${fmtDate(e.lastRetriedAt)}</strong></span>` : ''}
      </div>
    </div>
  `;
  return div;
}

function dlqCard(e) {
  const statusColor = {
    waiting:            'var(--status-failed)',
    retrying:           'var(--status-processing)',
    resolved:           'var(--status-completed)',
    permanently_failed: 'var(--status-failed)',
  }[e.dlqStatus] || 'var(--text-dim)';

  const statusBg = {
    waiting:            '#FFCCCC',
    retrying:           '#CCDDFF',
    resolved:           '#CCFFE0',
    permanently_failed: '#FFCCCC',
  }[e.dlqStatus] || '#E8E8E8';

  const canRetry = ['waiting','permanently_failed'].includes(e.dlqStatus);

  return `
    <div class="dlq-card" id="dlq-card-${e._id}">
      <div class="dlq-header" onclick="toggleDLQ('${e._id}')">
        <div class="dlq-header-left">
          <span class="prio prio-${e.priority || 2}">${e.priority || 2}</span>
          <div>
            <div class="dlq-job-type">${escHtml(e.jobType)}</div>
            <div class="dlq-job-id">${e.jobId}</div>
          </div>
          <div class="dlq-error-preview">${escHtml(e.errorMessage)}</div>
        </div>
        <div class="dlq-header-right">
          <span class="pill" style="background:${statusBg};color:${statusColor}">
            <span class="pill-dot" style="background:${statusColor}"></span>
            ${e.dlqStatus}
          </span>
          <span class="td-time">${relTime(e.createdAt)}</span>
          ${canRetry ? `<button class="btn btn-success btn-sm" onclick="event.stopPropagation(); retryDLQ('${e._id}')">↺ Retry</button>` : ''}
        </div>
      </div>
      <div class="dlq-body" id="dlq-body-${e._id}">
        <div class="dlq-section-label">Error</div>
        <div class="code-block">${escHtml(e.errorMessage)}</div>

        <div class="dlq-section-label">Stack Trace</div>
        <div class="code-block stack-trace">${escHtml(e.errorStack || 'No stack trace available.')}</div>

        <div class="dlq-section-label">Payload</div>
        <div class="code-block">${escHtml(JSON.stringify(e.payload, null, 2))}</div>

        <div style="display:flex;gap:16px;margin-top:14px;font-size:11px;font-family:var(--font-mono);color:var(--text-dim)">
          <span>Attempts: <strong style="color:var(--text)">${e.totalAttempts}</strong></span>
          <span>DLQ retries: <strong style="color:var(--text)">${e.retryCount}</strong></span>
          <span>Entered: <strong style="color:var(--text)">${fmtDate(e.createdAt)}</strong></span>
          ${e.lastRetriedAt ? `<span>Last retry: <strong style="color:var(--text)">${fmtDate(e.lastRetriedAt)}</strong></span>` : ''}
        </div>
      </div>
    </div>
  `;
}

function toggleDLQ(id) {
  const body = document.getElementById(`dlq-body-${id}`);
  body.classList.toggle('open');
}

async function retryDLQ(id) {
  try {
    const data = await apiFetch(`/dlq/${id}/retry`, { method: 'POST' });
    toast(`Re-queued as ${data.newJobId.slice(0,8)}`, 'ok');
    loadDLQ(dlqPage);
    loadStats();
  } catch (err) {
    toast(err.message, 'err');
  }
}

function setLive(ok) {
  const dot   = document.getElementById('live-dot');
  const label = document.getElementById('live-label');
  if (ok) {
    dot.classList.remove('stale');
    label.textContent = 'LIVE';
    document.getElementById('last-updated').textContent =
      'updated ' + new Date().toLocaleTimeString();
  } else {
    dot.classList.add('stale');
    label.textContent = 'OFFLINE';
  }
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    loadStats();
    const activeTab = document.querySelector('.tab-btn.active')?.dataset?.tab;
    if (activeTab === 'jobs') loadJobs(currentPage, true);
    if (activeTab === 'dlq')  loadDLQ(dlqPage, true);
  }, POLL_MS);
}

function statusPill(status) {
  return `<span class="pill ${status}"><span class="pill-dot"></span>${status}</span>`;
}

function escHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function relTime(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60)  return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  return `${Math.floor(s/86400)}d ago`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

loadStats();
startPolling();

async function loadBenchmark() {
  try {
    const data = await apiFetch('/benchmark');

    // Summary cards
    document.getElementById('bm-total-scenarios').textContent = data.results.length;
    document.getElementById('bm-wheel-wins').textContent = data.summary.wheelWins;
    document.getElementById('bm-heap-wins').textContent  = data.summary.heapWins;

    // Table rows
    document.getElementById('bm-rows').innerHTML = data.results.map(r => {
      const heapWon = r.winner === 'heap';
      return `<tr>
        <td class="td-type">${escHtml(r.scenario)}</td>
        <td class="td-time">${r.count.toLocaleString()}</td>
        <td class="td-time">${r.heap.insertMs.toFixed(3)}</td>
        <td class="td-time">${r.heap.extractMs.toFixed(3)}</td>
        <td class="td-time" style="${heapWon ? 'color:var(--status-completed);font-weight:700' : ''}">${r.heap.totalMs.toFixed(3)}</td>
        <td class="td-time">${r.timingWheel.insertMs.toFixed(3)}</td>
        <td class="td-time">${r.timingWheel.tickMs.toFixed(3)}</td>
        <td class="td-time" style="${!heapWon ? 'color:var(--status-completed);font-weight:700' : ''}">${r.timingWheel.totalMs.toFixed(3)}</td>
        <td>
          <span class="pill ${heapWon ? 'processing' : 'failed'}">
            <span class="pill-dot"></span>${heapWon ? 'Heap' : 'Wheel'}
          </span>
        </td>
      </tr>`;
    }).join('');

    // Chart — destroy previous instance if it exists
    if (window._bmChart) window._bmChart.destroy();
    window._bmChart = new Chart(document.getElementById('bm-chart'), {
      type: 'bar',
      data: {
        labels: data.results.map(r => r.scenario),
        datasets: [
          {
            label: 'Heap total (ms)',
            data: data.results.map(r => r.heap.totalMs),
            backgroundColor: '#0055FF',
            borderColor: '#000',
            borderWidth: 2,
            borderSkipped: false,
          },
          {
            label: 'Timing Wheel total (ms)',
            data: data.results.map(r => r.timingWheel.totalMs),
            backgroundColor: '#FF2D6F',
            borderColor: '#000',
            borderWidth: 2,
            borderSkipped: false,
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(3)}ms`
            }
          }
        },
        scales: {
          x: {
            ticks: { font: { size: 9 }, maxRotation: 30, autoSkip: false },
            grid: { display: false }
          },
          y: {
            ticks: { callback: v => v + 'ms', font: { size: 9 } },
            grid: { color: '#eee' }
          }
        }
      }
    });
  } catch (err) {
    toast('Benchmark data unavailable — run: node benchmark/run.js', 'err');
  }
}