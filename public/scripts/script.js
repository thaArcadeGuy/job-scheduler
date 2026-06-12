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
      tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><div class="empty-icon">📭</div>No jobs yet. <a href="#" onclick="switchTab('create')">Create one →</a></div></td></tr>`;
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

async function loadJobs(page = 1) {
  currentPage = Math.max(1, page);
  const status   = document.getElementById('filter-status').value;
  const priority = document.getElementById('filter-priority').value;
  const params   = new URLSearchParams({ page: currentPage, limit: 15 });
  if (status)   params.set('status', status);
  if (priority) params.set('priority', priority);

  const tbody = document.getElementById('jobs-body');
  tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state"><div class="empty-icon"><div class="spinner"></div></div>Loading…</div></td></tr>`;

  try {
    const data = await apiFetch('/jobs?' + params);
    if (!data.jobs.length) {
      tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state"><div class="empty-icon">📭</div>No jobs match this filter.</div></td></tr>`;
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
    tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state"><div class="empty-icon">⚠️</div>${escHtml(err.message)}</div></td></tr>`;
  }
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

async function loadDLQ(page = 1) {
  dlqPage = Math.max(1, page);
  const status = document.getElementById('filter-dlq-status').value;
  const params = new URLSearchParams({ page: dlqPage, limit: 10 });
  if (status) params.set('status', status);

  const list = document.getElementById('dlq-list');
  list.innerHTML = '<div class="empty-state"><div class="empty-icon"><div class="spinner"></div></div>Loading…</div>';

  try {
    const data = await apiFetch('/dlq?' + params);

    if (!data.entries.length) {
      list.innerHTML = `<div class="empty-state"><div class="empty-icon">✅</div>DLQ is empty${status ? ' for this filter' : ''}.</div>`;
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
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div>${escHtml(err.message)}</div>`;
  }
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
    if (activeTab === 'jobs') loadJobs(currentPage);
    if (activeTab === 'dlq')  loadDLQ(dlqPage);
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
