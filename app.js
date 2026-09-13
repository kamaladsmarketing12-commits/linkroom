const API = '/api';
let currentLinks = [];
let currentDetailLink = null;
let charts = {};

// ---------- fetch helpers ----------
async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...opts,
  });
  if (res.status === 401) {
    showLogin();
    throw new Error('Not authenticated');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ---------- screens ----------
function showLogin() {
  document.getElementById('login-screen').hidden = false;
  document.getElementById('app-screen').hidden = true;
}
function showApp(email) {
  document.getElementById('login-screen').hidden = true;
  document.getElementById('app-screen').hidden = false;
  document.getElementById('user-email').textContent = email;
  loadLinks();
}

async function checkSession() {
  try {
    const me = await api('/auth/me');
    showApp(me.email);
  } catch (_) {
    showLogin();
  }
}

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  errEl.textContent = '';
  try {
    const res = await fetch(API + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    showApp(data.email);
  } catch (err) {
    errEl.textContent = err.message;
  }
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  await api('/auth/logout', { method: 'POST' });
  showLogin();
});

// ---------- tabs ----------
function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
}
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    switchTab(btn.dataset.tab);
    if (btn.dataset.tab === 'overview') loadOverview();
    if (btn.dataset.tab === 'links') loadLinks();
  });
});
document.getElementById('back-to-links').addEventListener('click', () => {
  document.querySelector('.tab-btn[data-tab="links"]').classList.add('active');
  document.querySelector('.tab-btn[data-tab="overview"]').classList.remove('active');
  switchTab('links');
});

// ---------- links list ----------
async function loadLinks() {
  currentLinks = await api('/links');
  const tbody = document.getElementById('links-tbody');
  tbody.innerHTML = '';
  document.getElementById('links-empty').hidden = currentLinks.length > 0;

  for (const link of currentLinks) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="cell-slug">/${escapeHtml(link.slug)}</td>
      <td class="cell-target" title="${escapeHtml(link.target_url)}">${escapeHtml(link.target_url)}</td>
      <td><span class="badge badge-type">${link.redirect_type}</span></td>
      <td>${link.total_clicks}</td>
      <td>${link.unique_clicks}</td>
      <td>${link.total_conversions}</td>
      <td><span class="badge ${link.active ? 'badge-active' : 'badge-inactive'}">${link.active ? 'Active' : 'Paused'}</span></td>
      <td class="row-actions">
        <button class="ghost-btn" data-action="edit" data-id="${link.id}">Edit</button>
        <button class="ghost-btn" data-action="toggle" data-id="${link.id}">${link.active ? 'Pause' : 'Resume'}</button>
        <button class="danger-link" data-action="delete" data-id="${link.id}">Delete</button>
      </td>
    `;
    tr.querySelector('.cell-slug').addEventListener('click', () => openDetail(link.id));
    tr.querySelector('.cell-target').addEventListener('click', () => openDetail(link.id));
    tbody.appendChild(tr);
  }

  tbody.querySelectorAll('button[data-action]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const action = btn.dataset.action;
      if (action === 'edit') return openModal(currentLinks.find((l) => l.id == id));
      if (action === 'toggle') { await api(`/links/${id}/toggle`, { method: 'POST' }); loadLinks(); }
      if (action === 'delete') {
        if (confirm('Delete this link and all of its click history? This cannot be undone.')) {
          await api(`/links/${id}`, { method: 'DELETE' });
          loadLinks();
        }
      }
    });
  });
}

// ---------- modal (create/edit) ----------
const modal = document.getElementById('link-modal');
document.getElementById('slug-prefix').textContent = location.origin + '/';

function openModal(link) {
  document.getElementById('modal-title').textContent = link ? 'Edit link' : 'New link';
  document.getElementById('link-id').value = link ? link.id : '';
  document.getElementById('link-slug').value = link ? link.slug : '';
  document.getElementById('link-target').value = link ? link.target_url : '';
  document.getElementById('link-title').value = link ? (link.title || '') : '';
  document.getElementById('link-redirect-type').value = link ? link.redirect_type : '301';
  document.getElementById('link-pass-utm').checked = link ? !!link.pass_utm : true;
  document.getElementById('link-notes').value = link ? (link.notes || '') : '';
  document.getElementById('modal-error').textContent = '';
  toggleCloakWarning();
  modal.hidden = false;
  document.getElementById('link-slug').focus();
}
function closeModal() { modal.hidden = true; }

function toggleCloakWarning() {
  const type = document.getElementById('link-redirect-type').value;
  document.getElementById('cloak-warning').hidden = !(type === 'meta' || type === 'js');
}
document.getElementById('link-redirect-type').addEventListener('change', toggleCloakWarning);

document.getElementById('new-link-btn').addEventListener('click', () => openModal(null));
document.getElementById('modal-cancel').addEventListener('click', closeModal);
modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

document.getElementById('link-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('link-id').value;
  const payload = {
    slug: document.getElementById('link-slug').value.trim(),
    target_url: document.getElementById('link-target').value.trim(),
    title: document.getElementById('link-title').value.trim(),
    redirect_type: document.getElementById('link-redirect-type').value,
    pass_utm: document.getElementById('link-pass-utm').checked ? 1 : 0,
    notes: document.getElementById('link-notes').value.trim(),
  };
  try {
    if (id) await api(`/links/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    else await api('/links', { method: 'POST', body: JSON.stringify(payload) });
    closeModal();
    loadLinks();
  } catch (err) {
    document.getElementById('modal-error').textContent = err.message;
  }
});

// ---------- link detail / stats ----------
async function openDetail(id) {
  switchTab('detail');
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
  const days = document.getElementById('detail-range').value;
  await renderDetail(id, days);
  document.getElementById('detail-range').onchange = () => renderDetail(id, document.getElementById('detail-range').value);
  document.getElementById('export-csv-btn').onclick = () => {
    window.location.href = `${API}/links/${id}/export.csv`;
  };
}

async function renderDetail(id, days) {
  const data = await api(`/links/${id}/stats?days=${days}`);
  currentDetailLink = data.link;
  document.getElementById('detail-title').textContent = `/${data.link.slug}`;

  document.getElementById('detail-stats').innerHTML = statBoxes([
    ['Total clicks', data.totals.total_clicks],
    ['Unique clicks', data.totals.unique_clicks],
    ['Conversions', data.totals.total_conversions],
    ['Redirect type', data.link.redirect_type],
  ]);

  drawLineChart('detail-chart', data.clicksOverTime);
  document.getElementById('detail-referrers').innerHTML = barList(data.topReferrers, 'referrer_host', 'clicks');
  document.getElementById('detail-campaigns').innerHTML = barList(data.topCampaigns, 'utm_campaign', 'clicks');
  document.getElementById('detail-locations').innerHTML = barList(data.topLocations, 'country', 'clicks');
  drawDoughnut('detail-device-chart', data.deviceBreakdown, 'device_type', 'clicks');

  const pixelUrl = `${location.origin}/pixel/${data.link.slug}.gif`;
  document.getElementById('pixel-snippet').textContent =
    `<img src="${pixelUrl}" width="1" height="1" style="display:none" alt="">`;
}

// ---------- overview ----------
async function loadOverview() {
  const days = document.getElementById('overview-range').value;
  await renderOverview(days);
  document.getElementById('overview-range').onchange = () => renderOverview(document.getElementById('overview-range').value);
}
async function renderOverview(days) {
  const data = await api(`/overview?days=${days}`);
  document.getElementById('overview-stats').innerHTML = statBoxes([
    ['Total clicks', data.totals.total_clicks],
    ['Unique clicks', data.totals.unique_clicks],
    ['Conversions', data.totals.total_conversions],
    ['Active links', `${data.totals.active_count} / ${data.totals.link_count}`],
  ]);
  drawLineChart('overview-chart', data.clicksOverTime);
  document.getElementById('overview-top-links').innerHTML = barList(
    data.topLinks.map((l) => ({ label: `/${l.slug}`, clicks: l.clicks })), 'label', 'clicks'
  );
}

// ---------- render helpers ----------
function statBoxes(pairs) {
  return pairs.map(([label, value]) => `
    <div class="stat-box">
      <div class="stat-value">${value}</div>
      <div class="stat-label">${label}</div>
    </div>`).join('');
}

function barList(rows, labelKey, valueKey) {
  if (!rows.length) return '<p class="muted">No data yet.</p>';
  const max = Math.max(...rows.map((r) => r[valueKey])) || 1;
  return `<div class="bar-list">${rows.map((r) => `
    <div class="bar-row">
      <span>${escapeHtml(String(r[labelKey]))}</span>
      <span class="mono">${r[valueKey]}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${(r[valueKey] / max) * 100}%"></div></div>
    </div>`).join('')}</div>`;
}

function drawLineChart(canvasId, rows) {
  const ctx = document.getElementById(canvasId);
  if (charts[canvasId]) charts[canvasId].destroy();
  charts[canvasId] = new Chart(ctx, {
    type: 'line',
    data: {
      labels: rows.map((r) => r.day),
      datasets: [
        { label: 'Clicks', data: rows.map((r) => r.clicks), borderColor: '#1F5B54', backgroundColor: 'rgba(31,91,84,0.08)', tension: 0.25, fill: true },
        { label: 'Unique', data: rows.map((r) => r.unique_clicks), borderColor: '#B98B33', tension: 0.25 },
      ],
    },
    options: { responsive: true, plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true } } },
  });
}

function drawDoughnut(canvasId, rows, labelKey, valueKey) {
  const ctx = document.getElementById(canvasId);
  if (charts[canvasId]) charts[canvasId].destroy();
  if (!rows.length) { ctx.getContext('2d').clearRect(0, 0, ctx.width, ctx.height); return; }
  charts[canvasId] = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: rows.map((r) => r[labelKey]),
      datasets: [{ data: rows.map((r) => r[valueKey]), backgroundColor: ['#1F5B54', '#B98B33', '#7A99A6', '#B3432B', '#8A8578'] }],
    },
    options: { plugins: { legend: { position: 'bottom' } } },
  });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

checkSession();
