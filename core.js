// ═══════════════════════════════════════════════════════════════
// FREIGHT ERP PRO — core.js
// Foundation: Supabase init, APP state, utilities, theme, pagination
// ═══════════════════════════════════════════════════════════════

// ─── PAGE LOADERS registry (modules.js and masters.js register here) ───
const PAGE_LOADERS = {};

// ─── APP STATE ───────────────────────────────────────────────────────────
const APP = {
  currentModule: 'dashboard',
  branch: { id: null, name: 'Loading...' },
  user:   { id: null, name: 'Admin', role: 'admin' },
  settings: {},
  cache: {
    parties:  [],
    drivers:  [],
    brokers:  [],
    branches: [],
    vehicles: [],
    rates:    [],
  },
  pagination: {
    lr:              { page: 1, pageSize: 50, total: 0 },
    bookings:        { page: 1, pageSize: 50, total: 0 },
    manifest:        { page: 1, pageSize: 50, total: 0 },
    delivery:        { page: 1, pageSize: 50, total: 0 },
    payments:        { page: 1, pageSize: 50, total: 0 },
    expenses:        { page: 1, pageSize: 50, total: 0 },
    eway:            { page: 1, pageSize: 50, total: 0 },
    reports:         { page: 1, pageSize: 50, total: 0 },
    auditlog:        { page: 1, pageSize: 100, total: 0 },
    parties_master:  { page: 1, pageSize: 50, total: 0 },
    drivers_master:  { page: 1, pageSize: 50, total: 0 },
    vehicles_master: { page: 1, pageSize: 50, total: 0 },
  }
};

// ─── SUPABASE CLIENT ──────────────────────────────────────────────────────
let db = null;


// ════════════════════════════════════════════════════════════════
// SESSION MANAGEMENT (mirrors login.html)
// ════════════════════════════════════════════════════════════════
function _loadSession() {
  const raw = localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw);
    if (s.expiry && Date.now() > s.expiry) { _clearSession(); return null; }
    return s;
  } catch(e) { return null; }
}

function _clearSession() {
  localStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(SESSION_KEY);
}

function logout() {
  _clearSession();
  window.location.href = 'login.html';
}

// ─── PAGE TITLES ──────────────────────────────────────────────────────────
const PAGE_TITLES = {
  dashboard:'Dashboard', bookings:'Bookings', lr:'Lorry Receipts',
  manifest:'Manifest', dispatch:'Dispatch', delivery:'Delivery',
  ledger:'Party Ledger', payments:'Payments', daybook:'Daybook',
  expenses:'Expenses', eway:'E-Way Bills', reports:'Reports',
  users:'Users & Roles', masters:'Masters', settings:'Company Settings',
  backup:'Backup / Restore', auditlog:'Audit Log'
};

// ═══════════════════════════════════════════════════════════════
// SECTION E: UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════

function getVal(id) {
  return document.getElementById(id)?.value?.trim() ?? '';
}

function setVal(id, val) {
  const el = document.getElementById(id);
  if (!el) return;
  el.value = (val === null || val === undefined) ? '' : val;
}

function setHTML(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

function show(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = '';
}

function hide(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
}

function num(n) {
  const v = parseFloat(n);
  if (isNaN(v)) return '0';
  return v.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

function numCompact(n) {
  const v = parseFloat(n) || 0;
  if (v >= 1_00_00_000) return '₹' + (v / 1_00_00_000).toFixed(1) + 'Cr';
  if (v >= 1_00_000)    return '₹' + (v / 1_00_000).toFixed(1) + 'L';
  return '₹' + num(v);
}

function formatDate(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
}

function formatDateTime(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  return d.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }) +
         ', ' + d.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', hour12:false });
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function slugToLabel(str) {
  if (!str) return '';
  return str.split('_').map(w => capitalize(w)).join(' ');
}

function statusTag(status) {
  const map = {
    booked: 'booked', in_transit: 'transit', delivered: 'delivered',
    partial: 'partial', cancelled: 'cancelled', draft: 'draft',
    dispatched: 'dispatched', pending: 'pending', lr_created: 'booked'
  };
  return map[status] || 'draft';
}

function paymentTag(type) {
  const map = { paid: 'paid', to_pay: 'topay', credit: 'credit', to_be_billed: 'billed' };
  return map[type] || 'draft';
}

function setBtnLoading(btnEl, isLoading, loadingText) {
  if (!btnEl) return;
  if (isLoading) {
    btnEl.dataset.origText = btnEl.textContent;
    btnEl.textContent = loadingText || 'LOADING...';
    btnEl.disabled = true;
  } else {
    btnEl.textContent = btnEl.dataset.origText || 'SAVE';
    btnEl.disabled = false;
  }
}

function showTableSkeleton(tbodyId, cols) {
  const el = document.getElementById(tbodyId);
  if (!el) return;
  let rows = '';
  for (let i = 0; i < 5; i++) {
    rows += `<tr><td colspan="${cols}" style="padding:10px 12px">
      <div style="background:var(--navy-700);height:12px;border-radius:2px;animation:shimmer 1.5s ease-in-out infinite"></div>
    </td></tr>`;
  }
  el.innerHTML = rows;
}

function exportCSV(arrayOfObjects, filename) {
  if (!arrayOfObjects || !arrayOfObjects.length) {
    toast('No data to export', 'warn');
    return;
  }
  const headers = Object.keys(arrayOfObjects[0]);
  const rows = [headers.join(',')].concat(
    arrayOfObjects.map(row =>
      headers.map(h => '"' + String(row[h] ?? '').replace(/"/g, '""') + '"').join(',')
    )
  );
  const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function resetFormInputs(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.querySelectorAll('input, textarea').forEach(el => { el.value = ''; });
  container.querySelectorAll('select').forEach(el => { el.selectedIndex = 0; });
}

// ═══════════════════════════════════════════════════════════════
// SECTION F: TOAST
// ═══════════════════════════════════════════════════════════════

function toast(msg, type = 'i') {
  const stack = document.getElementById('toastStack');
  if (!stack) return;
  const div = document.createElement('div');
  div.className = 'toast' + (type ? ' ' + type : '');
  div.textContent = msg;
  stack.appendChild(div);
  setTimeout(() => div.remove(), 3500);
}

// ═══════════════════════════════════════════════════════════════
// SECTION G: CUSTOM CONFIRM MODAL
// ═══════════════════════════════════════════════════════════════

function confirmAction(message) {
  return new Promise(resolve => {
    const modal = document.getElementById('confirmModal');
    const msgEl = document.getElementById('confirmMsg');
    const okBtn = document.getElementById('confirmOk');
    const cancelBtn = document.getElementById('confirmCancel');
    if (!modal) { resolve(true); return; }
    if (msgEl) msgEl.textContent = message;
    modal.classList.add('on');

    function cleanup(result) {
      modal.classList.remove('on');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      document.removeEventListener('keydown', onKey);
      resolve(result);
    }

    function onOk()    { cleanup(true); }
    function onCancel(){ cleanup(false); }
    function onKey(e)  { if (e.key === 'Escape') cleanup(false); }

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    document.addEventListener('keydown', onKey);
  });
}

// ═══════════════════════════════════════════════════════════════
// SECTION H: AUDIT LOG WRITER
// ═══════════════════════════════════════════════════════════════

function auditLog(action, module, recordId, recordRef, details) {
  if (!db) return;
  db.from('audit_log').insert({
    user_id: APP.user.id,
    user_name: APP.user.name,
    action,
    module,
    record_id: String(recordId || ''),
    record_ref: recordRef || '',
    details: details ? JSON.stringify(details) : null
  }).then(() => {});
}

// ═══════════════════════════════════════════════════════════════
// SECTION I: NUMBER SERIES GENERATOR
// ═══════════════════════════════════════════════════════════════

const PAD_WIDTHS = { lr: 6, booking: 6, manifest: 5, payment: 6, expense: 6 };
const YEAR = new Date().getFullYear();
const DEFAULT_PREFIXES = {
  lr: `LR/${YEAR}/`, booking: `BK/${YEAR}/`, manifest: `MNF/${YEAR}/`,
  payment: `PMT/${YEAR}/`, expense: `EXP/${YEAR}/`
};

async function getNextNumber(module) {
  const branchId = APP.branch.id;
  if (!branchId || !db) return DEFAULT_PREFIXES[module] + '000001';

  const { data, error } = await db.from('number_series')
    .select('*')
    .eq('module', module)
    .eq('branch_id', branchId)
    .single();

  const padWidth = PAD_WIDTHS[module] || 6;

  if (error || !data) {
    const prefix = DEFAULT_PREFIXES[module];
    const { data: ins } = await db.from('number_series').insert({
      branch_id: branchId, module, prefix, last_number: 1, pad_width: padWidth
    }).select().single();
    return prefix + '000001';
  }

  const next = (data.last_number || 0) + 1;
  await db.from('number_series').update({ last_number: next }).eq('id', data.id);
  return data.prefix + String(next).padStart(padWidth, '0');
}

// ═══════════════════════════════════════════════════════════════
// SECTION J: MASTER CACHE LOADER
// ═══════════════════════════════════════════════════════════════

async function loadAllMastersCache() {
  if (!db) return;
  try {
    const [p, d, b, br, v, r] = await Promise.all([
      db.from('parties').select('*').eq('is_active', true).order('name'),
      db.from('drivers').select('*').eq('is_active', true).order('name'),
      db.from('brokers').select('*').eq('is_active', true).order('name'),
      db.from('branches').select('*').eq('is_active', true).order('name'),
      db.from('vehicles').select('*').eq('is_active', true).order('vehicle_no'),
      db.from('rate_chart').select('*').order('from_city'),
    ]);
    if (p.data) APP.cache.parties  = p.data;
    if (d.data) APP.cache.drivers  = d.data;
    if (b.data) APP.cache.brokers  = b.data;
    if (br.data) {
      APP.cache.branches = br.data;
      if (!APP.branch.id && br.data.length > 0) {
        const saved = localStorage.getItem('erp_branch_id');
        const found = saved ? br.data.find(x => x.id === saved) : null;
        const branch = found || br.data[0];
        APP.branch = { id: branch.id, name: branch.name };
        const el = document.getElementById('sidebar-branch');
        if (el) el.textContent = branch.name;
      }
    }
    if (v.data) APP.cache.vehicles = v.data;
    if (r.data) APP.cache.rates    = r.data;
  } catch(e) {
    console.error('Cache load error:', e);
  }
}

// ═══════════════════════════════════════════════════════════════
// SECTION K: DROPDOWN POPULATOR
// ═══════════════════════════════════════════════════════════════

function populateAllDropdowns() {
  function buildOptions(arr, valueFn, labelFn, placeholder) {
    let html = placeholder ? `<option value="">${placeholder}</option>` : '';
    arr.forEach(item => {
      html += `<option value="${valueFn(item)}">${labelFn(item)}</option>`;
    });
    return html;
  }

  const allParties     = buildOptions(APP.cache.parties, p => p.id, p => p.name, '— Select Party —');
  const consignors     = buildOptions(APP.cache.parties.filter(p => p.type === 'consignor' || p.type === 'both'), p => p.id, p => p.name, '— Select Consignor —');
  const consignees     = buildOptions(APP.cache.parties.filter(p => p.type === 'consignee' || p.type === 'both'), p => p.id, p => p.name, '— Select Consignee —');
  const drivers        = buildOptions(APP.cache.drivers, d => d.id, d => d.name, '— Select Driver —');
  const vehicles       = buildOptions(APP.cache.vehicles, v => v.vehicle_no, v => v.vehicle_no + (v.owner_name ? ' — ' + v.owner_name : ''), '— Select Vehicle —');
  const brokersHtml    = '<option value="">— None —</option>' + APP.cache.brokers.map(b => `<option value="${b.id}">${b.name}</option>`).join('');
  const branchesHtml   = buildOptions(APP.cache.branches, b => b.id, b => b.name, '— Select Branch —');

  document.querySelectorAll('.sel-party').forEach(el => { el.innerHTML = allParties; });
  document.querySelectorAll('.sel-consignor').forEach(el => { el.innerHTML = consignors; });
  document.querySelectorAll('.sel-consignee').forEach(el => { el.innerHTML = consignees; });
  document.querySelectorAll('.sel-driver').forEach(el => { el.innerHTML = drivers; });
  document.querySelectorAll('.sel-vehicle').forEach(el => { el.innerHTML = vehicles; });
  // Also populate vehicle datalist for text inputs
  const vdl = document.getElementById('vehicle-datalist');
  if (vdl) vdl.innerHTML = APP.cache.vehicles.map(v => `<option value="${v.vehicle_no}">${v.vehicle_no}${v.owner_name ? ' — ' + v.owner_name : ''}</option>`).join('');
  document.querySelectorAll('.sel-broker').forEach(el => { el.innerHTML = brokersHtml; });
  document.querySelectorAll('.sel-branch, .sel-from-branch, .sel-to-branch').forEach(el => { el.innerHTML = branchesHtml; });
}

// ═══════════════════════════════════════════════════════════════
// PAGINATION ENGINE
// ═══════════════════════════════════════════════════════════════

function getTotalPages(module) {
  const p = APP.pagination[module];
  return Math.max(1, Math.ceil((p.total || 0) / (p.pageSize || 50)));
}

function goToPage(module, page) {
  const tp = getTotalPages(module);
  if (page < 1) page = 1;
  if (page > tp) page = tp;
  APP.pagination[module].page = page;
  if (PAGE_LOADERS[module]) PAGE_LOADERS[module]();
}

function nextPage(module) {
  const p = APP.pagination[module];
  if (p.page < getTotalPages(module)) goToPage(module, p.page + 1);
}

function prevPage(module) {
  const p = APP.pagination[module];
  if (p.page > 1) goToPage(module, p.page - 1);
}

function changePageSize(module, size) {
  APP.pagination[module].pageSize = parseInt(size);
  APP.pagination[module].page = 1;
  localStorage.setItem('erp_ps_' + module, size);
  if (PAGE_LOADERS[module]) PAGE_LOADERS[module]();
}

function resetPage(module) {
  APP.pagination[module].page = 1;
}

function buildPageButtons(currentPage, totalPages) {
  const pages = new Set();
  pages.add(1);
  pages.add(totalPages);
  for (let i = Math.max(1, currentPage - 2); i <= Math.min(totalPages, currentPage + 2); i++) {
    pages.add(i);
  }
  const sorted = [...pages].sort((a, b) => a - b);
  const result = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i-1] > 2) {
      result.push('...');
    } else if (i > 0 && sorted[i] - sorted[i-1] === 2) {
      result.push(sorted[i] - 1);
    }
    result.push(sorted[i]);
  }
  return result;
}

function renderPagination(containerId, module) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const p = APP.pagination[module];
  const total = p.total || 0;
  const page = p.page || 1;
  const pageSize = p.pageSize || 50;
  const totalPages = getTotalPages(module);

  const fromRec = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const toRec   = Math.min(page * pageSize, total);
  const infoText = total === 0
    ? 'SHOWING 0 RECORDS'
    : `SHOWING ${num(fromRec)}–${num(toRec)} OF ${num(total)} RECORDS`;

  const pageSizeOpts = [25, 50, 100, 250].map(s =>
    `<option value="${s}" ${p.pageSize === s ? 'selected' : ''}>${s} / page</option>`
  ).join('');

  let btns = '';
  if (totalPages > 1) {
    const prevStyle = page === 1 ? 'style="opacity:0.35;pointer-events:none"' : '';
    const nextStyle = page >= totalPages ? 'style="opacity:0.35;pointer-events:none"' : '';
    btns += `<div class="pg-btn" onclick="prevPage('${module}')" ${prevStyle}>‹ PREV</div>`;
    buildPageButtons(page, totalPages).forEach(item => {
      if (item === '...') {
        btns += `<div class="pg-btn" style="pointer-events:none;opacity:0.5;cursor:default">…</div>`;
      } else {
        const isCur = item === page;
        btns += `<div class="pg-btn${isCur ? ' cur' : ''}" onclick="goToPage('${module}', ${item})">${item}</div>`;
      }
    });
    btns += `<div class="pg-btn" onclick="nextPage('${module}')" ${nextStyle}>NEXT ›</div>`;
  }

  let jumpInput = '';
  if (totalPages > 20) {
    jumpInput = `<input class="fi" type="number" min="1" max="${totalPages}" placeholder="Go to"
      style="width:60px;font-size:11px;padding:5px 8px;margin-left:4px"
      onkeydown="if(event.key==='Enter'){goToPage('${module}', parseInt(this.value));this.value='';}">`;
  }

  container.innerHTML = `
    <span class="pg-info">${infoText}</span>
    ${btns}
    <select class="fsel" style="width:95px;font-size:10.5px;margin-left:8px"
            onchange="changePageSize('${module}', this.value)">
      ${pageSizeOpts}
    </select>
    ${jumpInput}
  `;
}

// ─── KEYBOARD NAVIGATION ───────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  const tag = document.activeElement?.tagName?.toLowerCase();
  if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
  const m = APP.currentModule;
  if (!APP.pagination[m]) return;
  if (e.key === 'ArrowLeft' || e.key === '[')  { e.preventDefault(); prevPage(m); }
  if (e.key === 'ArrowRight' || e.key === ']') { e.preventDefault(); nextPage(m); }
  if (e.key === 'Home') { e.preventDefault(); goToPage(m, 1); }
  if (e.key === 'End')  { e.preventDefault(); goToPage(m, getTotalPages(m)); }
});

// ═══════════════════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════════════════

function go(pg, el) {
  document.querySelectorAll('.pg').forEach(p => p.classList.remove('on'));
  document.querySelectorAll('.nav-link').forEach(n => n.classList.remove('active'));
  const p = document.getElementById('pg-' + pg);
  if (p) p.classList.add('on');
  if (el) {
    el.classList.add('active');
  } else {
    const navEl = document.querySelector(`[data-pg="${pg}"]`);
    if (navEl) navEl.classList.add('active');
  }
  document.getElementById('tb-cur').textContent = PAGE_TITLES[pg] || pg;
  APP.currentModule = pg;
  const notif = document.getElementById('notifPanel');
  if (notif) notif.classList.remove('on');

  // Trigger data loader
  const loaderMap = {
    dashboard: () => { if (typeof loadDashboard === 'function') loadDashboard(); },
    bookings:  () => { if (typeof loadBookings === 'function') loadBookings(); },
    lr:        () => { if (typeof loadLRRegister === 'function') loadLRRegister(); },
    manifest:  () => { if (typeof loadManifest === 'function') loadManifest(); },
    dispatch:  () => { if (typeof loadDispatch === 'function') loadDispatch(); },
    delivery:  () => { if (typeof loadDelivery === 'function') loadDelivery(); },
    ledger:    () => { if (typeof populateLedgerDropdown === 'function') populateLedgerDropdown(); },
    payments:  () => { if (typeof loadPayments === 'function') loadPayments(); },
    daybook:   () => { if (typeof loadDaybook === 'function') loadDaybook(today()); },
    expenses:  () => { if (typeof loadExpenses === 'function') loadExpenses(); },
    eway:      () => { if (typeof loadEway === 'function') loadEway(); },
    users:     () => { if (typeof loadUsers === 'function') loadUsers(); },
    masters:   () => { if (typeof loadMastersBranches === 'function') loadMastersBranches(); },
    settings:  () => { if (typeof loadSettings === 'function') loadSettings(); },
    auditlog:  () => { if (typeof loadAuditLog === 'function') loadAuditLog(); },
  };
  if (loaderMap[pg]) loaderMap[pg]();
}

// ─── MODALS ────────────────────────────────────────────────────────────────
function M(id) { const el = document.getElementById(id); if (el) el.classList.add('on'); }
function C(id) { const el = document.getElementById(id); if (el) el.classList.remove('on'); }

// ═══════════════════════════════════════════════════════════════
// COLOUR THEME ENGINE
// ═══════════════════════════════════════════════════════════════

const ThemeEngine = {
  presets: {
    'midnight-navy': {
      '--navy-950':'#03070f','--navy-900':'#060d1a','--navy-850':'#080f1f',
      '--navy-800':'#0c1628','--navy-750':'#0f1c32','--navy-700':'#132138',
      '--navy-600':'#1a2d4a','--navy-500':'#1e3554',
      '--steel-400':'#8fa8c8','--steel-300':'#a8bfd4','--steel-200':'#c4d4e3',
      '--steel-100':'#e0eaf4','--steel-50':'#f0f5fa',
      '--accent':'#2563eb','--accent-bright':'#3b82f6','--accent-glow':'rgba(37,99,235,0.18)',
      '--text-pri':'#e0eaf4','--text-sec':'#8fa8c8','--text-muted':'#4a6280',
      '--border':'rgba(143,168,200,0.1)','--border-2':'rgba(143,168,200,0.18)','--border-3':'rgba(143,168,200,0.28)',
      '--green':'#16a34a','--green-dim':'rgba(22,163,74,0.12)',
      '--red':'#dc2626','--red-dim':'rgba(220,38,38,0.1)',
      '--amber':'#d97706','--amber-dim':'rgba(217,119,6,0.12)',
      '--gold':'#d4a847','--gold-dim':'rgba(212,168,71,0.12)',
      '--cyan':'#0891b2','--cyan-dim':'rgba(8,145,178,0.1)',
    },
    'carbon-black': {
      '--navy-950':'#040404','--navy-900':'#0a0a0a','--navy-850':'#111111',
      '--navy-800':'#181818','--navy-750':'#1f1f1f','--navy-700':'#272727',
      '--navy-600':'#303030','--navy-500':'#3a3a3a',
      '--steel-400':'#808080','--steel-300':'#b0b0b0','--steel-200':'#d0d0d0',
      '--steel-100':'#e8e8e8','--steel-50':'#f2f2f2',
      '--accent':'#e07b00','--accent-bright':'#f59e0b','--accent-glow':'rgba(224,123,0,0.15)',
      '--text-pri':'#f2f2f2','--text-sec':'#a0a0a0','--text-muted':'#555555',
      '--border':'rgba(255,255,255,0.08)','--border-2':'rgba(255,255,255,0.14)','--border-3':'rgba(255,255,255,0.22)',
      '--green':'#16a34a','--green-dim':'rgba(22,163,74,0.12)',
      '--red':'#dc2626','--red-dim':'rgba(220,38,38,0.1)',
      '--amber':'#d97706','--amber-dim':'rgba(217,119,6,0.12)',
      '--gold':'#d4a847','--gold-dim':'rgba(212,168,71,0.12)',
      '--cyan':'#0891b2','--cyan-dim':'rgba(8,145,178,0.1)',
    },
    'forest-green': {
      '--navy-950':'#010802','--navy-900':'#021005','--navy-850':'#051a08',
      '--navy-800':'#0a2410','--navy-750':'#102e16','--navy-700':'#173d1e',
      '--navy-600':'#1e4d26','--navy-500':'#266030',
      '--steel-400':'#5a8f5a','--steel-300':'#8cba8c','--steel-200':'#b0d4b0',
      '--steel-100':'#d0ead0','--steel-50':'#e8f5e9',
      '--accent':'#22c55e','--accent-bright':'#4ade80','--accent-glow':'rgba(34,197,94,0.15)',
      '--text-pri':'#e8f5e9','--text-sec':'#a5d6a7','--text-muted':'#4a7a50',
      '--border':'rgba(34,197,94,0.08)','--border-2':'rgba(34,197,94,0.15)','--border-3':'rgba(34,197,94,0.25)',
      '--green':'#16a34a','--green-dim':'rgba(22,163,74,0.12)',
      '--red':'#dc2626','--red-dim':'rgba(220,38,38,0.1)',
      '--amber':'#d97706','--amber-dim':'rgba(217,119,6,0.12)',
      '--gold':'#d4a847','--gold-dim':'rgba(212,168,71,0.12)',
      '--cyan':'#0891b2','--cyan-dim':'rgba(8,145,178,0.1)',
    },
    'deep-purple': {
      '--navy-950':'#060010','--navy-900':'#0d0020','--navy-850':'#140030',
      '--navy-800':'#1c0040','--navy-750':'#240050','--navy-700':'#2d0063',
      '--navy-600':'#370078','--navy-500':'#42008f',
      '--steel-400':'#8870c0','--steel-300':'#b09de0','--steel-200':'#d0c0ff',
      '--steel-100':'#e8e0ff','--steel-50':'#f4f0ff',
      '--accent':'#8b5cf6','--accent-bright':'#a78bfa','--accent-glow':'rgba(139,92,246,0.18)',
      '--text-pri':'#ede9fe','--text-sec':'#c4b5fd','--text-muted':'#7c6a9a',
      '--border':'rgba(139,92,246,0.10)','--border-2':'rgba(139,92,246,0.18)','--border-3':'rgba(139,92,246,0.28)',
      '--green':'#16a34a','--green-dim':'rgba(22,163,74,0.12)',
      '--red':'#dc2626','--red-dim':'rgba(220,38,38,0.1)',
      '--amber':'#d97706','--amber-dim':'rgba(217,119,6,0.12)',
      '--gold':'#d4a847','--gold-dim':'rgba(212,168,71,0.12)',
      '--cyan':'#0891b2','--cyan-dim':'rgba(8,145,178,0.1)',
    },
    'slate-ocean': {
      '--navy-950':'#080e1a','--navy-900':'#0f172a','--navy-850':'#1a2540',
      '--navy-800':'#1e293b','--navy-750':'#263347','--navy-700':'#334155',
      '--navy-600':'#3d4f66','--navy-500':'#475569',
      '--steel-400':'#7890b0','--steel-300':'#a8b8d0','--steel-200':'#cdd8e8',
      '--steel-100':'#e8eef6','--steel-50':'#f4f7fb',
      '--accent':'#0ea5e9','--accent-bright':'#38bdf8','--accent-glow':'rgba(14,165,233,0.15)',
      '--text-pri':'#f1f5f9','--text-sec':'#cbd5e1','--text-muted':'#64748b',
      '--border':'rgba(100,116,139,0.12)','--border-2':'rgba(100,116,139,0.20)','--border-3':'rgba(100,116,139,0.30)',
      '--green':'#16a34a','--green-dim':'rgba(22,163,74,0.12)',
      '--red':'#dc2626','--red-dim':'rgba(220,38,38,0.1)',
      '--amber':'#d97706','--amber-dim':'rgba(217,119,6,0.12)',
      '--gold':'#d4a847','--gold-dim':'rgba(212,168,71,0.12)',
      '--cyan':'#0891b2','--cyan-dim':'rgba(8,145,178,0.1)',
    },
    'crimson-dark': {
      '--navy-950':'#080000','--navy-900':'#100202','--navy-850':'#1a0505',
      '--navy-800':'#220808','--navy-750':'#2a0d0d','--navy-700':'#341212',
      '--navy-600':'#3e1616','--navy-500':'#4a1c1c',
      '--steel-400':'#b07070','--steel-300':'#d0a0a0','--steel-200':'#e8c8c8',
      '--steel-100':'#f8e8e8','--steel-50':'#fdf4f4',
      '--accent':'#dc2626','--accent-bright':'#ef4444','--accent-glow':'rgba(220,38,38,0.15)',
      '--text-pri':'#faf0f0','--text-sec':'#d4a0a0','--text-muted':'#7a5050',
      '--border':'rgba(220,38,38,0.08)','--border-2':'rgba(220,38,38,0.15)','--border-3':'rgba(220,38,38,0.25)',
      '--green':'#16a34a','--green-dim':'rgba(22,163,74,0.12)',
      '--red':'#dc2626','--red-dim':'rgba(220,38,38,0.1)',
      '--amber':'#d97706','--amber-dim':'rgba(217,119,6,0.12)',
      '--gold':'#d4a847','--gold-dim':'rgba(212,168,71,0.12)',
      '--cyan':'#0891b2','--cyan-dim':'rgba(8,145,178,0.1)',
    },
    'day-mode': {
      '--navy-950':'#e8edf4','--navy-900':'#f8fafc','--navy-850':'#ffffff',
      '--navy-800':'#f1f5f9','--navy-750':'#e8edf5','--navy-700':'#dde4ee',
      '--navy-600':'#cbd5e1','--navy-500':'#b8c5d6',
      '--steel-400':'#64748b','--steel-300':'#475569','--steel-200':'#334155',
      '--steel-100':'#1e293b','--steel-50':'#0f172a',
      '--accent':'#2563eb','--accent-bright':'#3b82f6','--accent-glow':'rgba(37,99,235,0.12)',
      '--text-pri':'#0f172a','--text-sec':'#334155','--text-muted':'#64748b',
      '--border':'rgba(0,0,0,0.08)','--border-2':'rgba(0,0,0,0.14)','--border-3':'rgba(0,0,0,0.22)',
      '--green':'#16a34a','--green-dim':'rgba(22,163,74,0.10)',
      '--red':'#dc2626','--red-dim':'rgba(220,38,38,0.08)',
      '--amber':'#d97706','--amber-dim':'rgba(217,119,6,0.10)',
      '--gold':'#b45309','--gold-dim':'rgba(180,83,9,0.10)',
      '--cyan':'#0891b2','--cyan-dim':'rgba(8,145,178,0.08)',
    },
    'warm-sunset': {
      '--navy-950':'#080400','--navy-900':'#100800','--navy-850':'#1a1000',
      '--navy-800':'#221600','--navy-750':'#2c1e00','--navy-700':'#382800',
      '--navy-600':'#443200','--navy-500':'#523d00',
      '--steel-400':'#b89840','--steel-300':'#d8c070','--steel-200':'#f0e0a0',
      '--steel-100':'#fff8e0','--steel-50':'#fffdf5',
      '--accent':'#d97706','--accent-bright':'#f59e0b','--accent-glow':'rgba(217,119,6,0.18)',
      '--text-pri':'#fef3c7','--text-sec':'#d4a847','--text-muted':'#8a7040',
      '--border':'rgba(212,168,71,0.10)','--border-2':'rgba(212,168,71,0.18)','--border-3':'rgba(212,168,71,0.28)',
      '--green':'#16a34a','--green-dim':'rgba(22,163,74,0.12)',
      '--red':'#dc2626','--red-dim':'rgba(220,38,38,0.1)',
      '--amber':'#d97706','--amber-dim':'rgba(217,119,6,0.12)',
      '--gold':'#d4a847','--gold-dim':'rgba(212,168,71,0.12)',
      '--cyan':'#0891b2','--cyan-dim':'rgba(8,145,178,0.1)',
    },
  },

  apply(vars) {
    Object.entries(vars).forEach(([k, v]) => {
      document.documentElement.style.setProperty(k, v);
    });
    localStorage.setItem('erp_theme_vars', JSON.stringify(vars));
  },

  async save(themeName, vars) {
    this.apply(vars);
    localStorage.setItem('erp_theme_name', themeName);
    if (db) {
      const { data } = await db.from('company_settings').select('id').limit(1).single();
      if (data) {
        await db.from('company_settings').update({ ui_theme: themeName, ui_custom_colors: vars }).eq('id', data.id);
      }
    }
    // update active preset UI
    document.querySelectorAll('.theme-card').forEach(c => {
      c.classList.toggle('theme-active', c.dataset.theme === themeName);
      const badge = c.querySelector('.theme-badge');
      if (badge) badge.style.display = c.dataset.theme === themeName ? '' : 'none';
    });
    toast('Theme applied', 'ok');
  },

  load() {
    const saved = localStorage.getItem('erp_theme_vars');
    if (saved) {
      try { this.apply(JSON.parse(saved)); } catch(e) {}
    }
    // Async confirm from Supabase — done after boot
  },

  reset() {
    this.apply(this.presets['midnight-navy']);
    localStorage.setItem('erp_theme_name', 'midnight-navy');
    localStorage.removeItem('erp_theme_vars');
    toast('Reset to default theme', 'ok');
  },

  fromCustomPickers() {
    const bg    = document.getElementById('cp-bg')?.value    || '#060d1a';
    const side  = document.getElementById('cp-side')?.value  || '#03070f';
    const acc   = document.getElementById('cp-acc')?.value   || '#2563eb';
    const txt   = document.getElementById('cp-txt')?.value   || '#e0eaf4';
    const succ  = document.getElementById('cp-succ')?.value  || '#16a34a';
    const err   = document.getElementById('cp-err')?.value   || '#dc2626';

    // Derive scale from bg hex
    function lighten(hex, amt) {
      const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
      return `rgb(${Math.min(255,r+amt)},${Math.min(255,g+amt)},${Math.min(255,b+amt)})`;
    }
    function alpha(hex, a) {
      const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
      return `rgba(${r},${g},${b},${a})`;
    }

    const vars = {
      '--navy-950': side,
      '--navy-900': bg,
      '--navy-850': lighten(bg, 8),
      '--navy-800': lighten(bg, 16),
      '--navy-750': lighten(bg, 24),
      '--navy-700': lighten(bg, 32),
      '--navy-600': lighten(bg, 48),
      '--navy-500': lighten(bg, 64),
      '--steel-400': alpha(txt, 0.5),
      '--steel-300': alpha(txt, 0.65),
      '--steel-200': alpha(txt, 0.8),
      '--steel-100': txt,
      '--steel-50':  lighten(txt.replace('#','').length === 6 ? txt : '#e0eaf4', 20),
      '--accent': acc,
      '--accent-bright': lighten(acc, 20),
      '--accent-glow': alpha(acc, 0.18),
      '--text-pri': txt,
      '--text-sec': alpha(txt, 0.65),
      '--text-muted': alpha(txt, 0.35),
      '--border': alpha(txt, 0.1),
      '--border-2': alpha(txt, 0.18),
      '--border-3': alpha(txt, 0.28),
      '--green': succ,
      '--green-dim': alpha(succ, 0.12),
      '--red': err,
      '--red-dim': alpha(err, 0.1),
      '--amber': '#d97706',
      '--amber-dim': 'rgba(217,119,6,0.12)',
      '--gold': '#d4a847',
      '--gold-dim': 'rgba(212,168,71,0.12)',
      '--cyan': '#0891b2',
      '--cyan-dim': 'rgba(8,145,178,0.1)',
    };
    this.apply(vars);
  },
};

// ═══════════════════════════════════════════════════════════════
// GLOBAL SEARCH
// ═══════════════════════════════════════════════════════════════

let searchDebounce = null;

function initGlobalSearch() {
  const input = document.getElementById('globalSearch');
  const resultsDiv = document.getElementById('searchResults');
  if (!input || !resultsDiv) return;

  input.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    const q = input.value.trim();
    if (q.length < 2) { resultsDiv.style.display = 'none'; return; }
    searchDebounce = setTimeout(() => runGlobalSearch(q), 400);
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('.tb-search') && !e.target.closest('#searchResults')) {
      resultsDiv.style.display = 'none';
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { resultsDiv.style.display = 'none'; input.value = ''; }
  });
}

async function runGlobalSearch(q) {
  if (!db) return;
  const resultsDiv = document.getElementById('searchResults');
  if (!resultsDiv) return;

  const [lrRes, bkRes, partyRes] = await Promise.all([
    db.from('lorry_receipts').select('id,lr_number,vehicle_no,status')
      .or(`lr_number.ilike.%${q}%,vehicle_no.ilike.%${q}%`).limit(5),
    db.from('bookings').select('id,booking_no,status')
      .ilike('booking_no', `%${q}%`).limit(5),
    db.from('parties').select('id,name,type')
      .ilike('name', `%${q}%`).limit(5),
  ]);

  const results = [];
  (lrRes.data || []).forEach(r => results.push({ type:'lr', id:r.id, ref:r.lr_number, sub:r.vehicle_no, status:r.status }));
  (bkRes.data || []).forEach(r => results.push({ type:'booking', id:r.id, ref:r.booking_no, sub:r.status, status:r.status }));
  (partyRes.data || []).forEach(r => results.push({ type:'party', id:r.id, ref:r.name, sub:r.type }));

  if (results.length === 0) {
    resultsDiv.innerHTML = `<div style="padding:12px 14px;font-size:11.5px;color:var(--text-muted)">No results for "${q}"</div>`;
  } else {
    resultsDiv.innerHTML = results.map(r => `
      <div class="search-result-item" onclick="handleSearchClick('${r.type}','${r.id}','${r.ref}')"
           style="padding:9px 14px;cursor:pointer;border-bottom:1px solid var(--border);
                  display:flex;align-items:center;gap:10px;transition:background 0.1s"
           onmouseover="this.style.background='var(--navy-800)'"
           onmouseout="this.style.background='transparent'">
        <span style="font-family:var(--font-mono);font-size:8.5px;letter-spacing:1px;
                     text-transform:uppercase;color:var(--accent-bright);min-width:50px">${r.type.toUpperCase()}</span>
        <span style="font-family:var(--font-mono);font-size:11.5px;color:var(--text-pri);flex:1">${r.ref}</span>
        <span style="font-size:10.5px;color:var(--text-muted)">${r.sub || ''}</span>
      </div>
    `).join('');
  }
  resultsDiv.style.display = '';
}

function handleSearchClick(type, id, ref) {
  const resultsDiv = document.getElementById('searchResults');
  const input = document.getElementById('globalSearch');
  if (resultsDiv) resultsDiv.style.display = 'none';
  if (input) input.value = '';

  if (type === 'lr')      { go('lr', null); }
  if (type === 'booking') { go('bookings', null); }
  if (type === 'party')   { go('ledger', null); }
}

// ═══════════════════════════════════════════════════════════════
// PRINT FUNCTION
// ═══════════════════════════════════════════════════════════════

async function printLR(lrId) {
  if (!db || !lrId) { window.print(); return; }
  const { data: lr } = await db.from('lorry_receipts')
    .select('*, consignor:consignor_id(name), consignee:consignee_id(name), driver:driver_id(name)')
    .eq('id', lrId).single();
  if (!lr) { window.print(); return; }

  const settings = APP.settings;
  setHTML('print-company', settings.company_name || 'Your Company');
  setHTML('print-details', [settings.address, settings.gstin ? 'GSTIN: ' + settings.gstin : '', settings.phone].filter(Boolean).join(' · '));

  const paperEl = document.getElementById('receipt-full');
  if (paperEl) {
    // Update header fields in print modal
    const headerEl = paperEl.querySelector('[data-lr-number]');
    if (headerEl) headerEl.textContent = lr.lr_number;
  }

  document.body.classList.add('print-mode');
  window.print();
  document.body.classList.remove('print-mode');
}

// ═══════════════════════════════════════════════════════════════
// NOTIFICATION PANEL
// ═══════════════════════════════════════════════════════════════

async function loadNotifications() {
  if (!db) return;
  const twoDaysOut = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0,10);
  const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().slice(0,10);

  const [ewayRes, overdueRes, creditRes] = await Promise.all([
    db.from('lorry_receipts').select('lr_number, eway_expiry_date, eway_status')
      .not('eway_bill_no', 'is', null).neq('eway_bill_no', '')
      .lte('eway_expiry_date', twoDaysOut).neq('status', 'cancelled').limit(10),
    db.from('lorry_receipts').select('lr_number, lr_date')
      .eq('status', 'in_transit').lt('lr_date', fiveDaysAgo).limit(5),
    db.from('parties').select('name, outstanding_balance, credit_limit')
      .gt('credit_limit', 0).limit(5),
  ]);

  const items = [];
  (ewayRes.data || []).forEach(r => {
    const isExpired = r.eway_expiry_date < today();
    items.push({
      color: isExpired ? 'var(--red)' : 'var(--amber)',
      title: isExpired ? 'E-Way Bill EXPIRED' : 'E-Way Expiring Soon',
      msg: `${r.lr_number} — Expiry: ${formatDate(r.eway_expiry_date)}`,
    });
  });
  (overdueRes.data || []).forEach(r => {
    items.push({ color: 'var(--amber)', title: 'Pending Delivery', msg: `${r.lr_number} — In transit since ${formatDate(r.lr_date)}` });
  });
  (creditRes.data || []).forEach(r => {
    if (r.credit_limit > 0 && r.outstanding_balance > r.credit_limit * 0.9) {
      const pct = Math.round(r.outstanding_balance / r.credit_limit * 100);
      items.push({ color: 'var(--accent-bright)', title: 'Credit Limit Warning', msg: `${r.name} — ${pct}% utilized` });
    }
  });

  const panel = document.getElementById('notifPanel');
  const badge = document.querySelector('.notif-count');
  if (badge) badge.textContent = Math.min(items.length, 99);

  if (panel) {
    const hd = panel.querySelector('.notif-hd');
    const unreadSpan = hd?.querySelector('span');
    if (unreadSpan) unreadSpan.textContent = `${items.length} ALERTS`;

    // Remove old items (keep header)
    [...panel.children].slice(1).forEach(c => c.remove());
    if (items.length === 0) {
      panel.insertAdjacentHTML('beforeend', `<div style="padding:16px;text-align:center;font-size:11.5px;color:var(--text-muted)">No alerts</div>`);
    } else {
      items.forEach(item => {
        panel.insertAdjacentHTML('beforeend', `
          <div class="notif-item unread">
            <div class="ni-ico" style="background:${item.color}"></div>
            <div><div class="ni-title">${item.title}</div><div class="ni-msg">${item.msg}</div></div>
          </div>
        `);
      });
    }
  }
}

function toggleNotif() {
  const p = document.getElementById('notifPanel');
  if (p) p.classList.toggle('on');
}

// ─── E-WAY EXPIRY CHECK ────────────────────────────────────────────────────
async function checkEwayExpiry() {
  if (!db) return;
  const { data } = await db.from('lorry_receipts')
    .select('id, lr_number, eway_expiry_date')
    .not('eway_bill_no', 'is', null)
    .neq('status', 'cancelled')
    .limit(100);
  if (!data) return;

  const dashAlerts = document.getElementById('dash-alerts');
  const expired = data.filter(r => r.eway_expiry_date && r.eway_expiry_date < today());
  const expiring24h = data.filter(r => {
    if (!r.eway_expiry_date || r.eway_expiry_date < today()) return false;
    const diff = new Date(r.eway_expiry_date) - new Date();
    return diff <= 24 * 60 * 60 * 1000;
  });

  if (dashAlerts) {
    let alerts = '';
    if (expired.length > 0) {
      alerts += `<div class="alert alert-e"><strong>CRITICAL:</strong>&nbsp; ${expired.length} E-Way Bill(s) EXPIRED — ${expired[0].lr_number}. Immediate action required.</div>`;
    }
    if (expiring24h.length > 0) {
      alerts += `<div class="alert alert-w"><strong>WARNING:</strong>&nbsp; ${expiring24h.length} E-Way Bill(s) expiring within 24 hours. Navigate to E-Way Bills module.</div>`;
    }
    dashAlerts.innerHTML = alerts;
  }
}

// ─── CLOCK ─────────────────────────────────────────────────────────────────
function updateClock() {
  const now = new Date();
  const t = now.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false });
  const d = now.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
  const cl = document.getElementById('clock');
  if (cl) cl.textContent = `${d}  ${t}`;
}

// ─── BRANCH SWITCHER ────────────────────────────────────────────────────────
function switchBranch(branchId, branchName, el) {
  APP.branch = { id: branchId, name: branchName };
  localStorage.setItem('erp_branch_id', branchId);
  localStorage.setItem('erp_branch_name', branchName);
  document.getElementById('sidebar-branch').textContent = branchName;

  // Update modal UI
  document.querySelectorAll('#branch-list > div').forEach(d => {
    d.style.background = 'var(--navy-800)';
    d.style.borderColor = 'var(--border)';
    const s = d.querySelector('span:last-child');
    if (s) { s.textContent = 'SWITCH →'; s.style.color = 'var(--text-muted)'; }
  });
  if (el) {
    el.style.background = 'rgba(37,99,235,.1)';
    el.style.borderColor = 'rgba(37,99,235,.2)';
    const s = el.querySelector('span:last-child');
    if (s) { s.textContent = 'ACTIVE'; s.style.color = 'var(--accent-bright)'; }
  }

  C('branchModal');
  toast(`Switched to ${branchName}`, 'ok');
  if (PAGE_LOADERS[APP.currentModule]) PAGE_LOADERS[APP.currentModule]();
}

async function loadBranchModal() {
  const listEl = document.getElementById('branch-list');
  if (!listEl || !db) return;
  const { data } = await db.from('branches').select('*').eq('is_active', true).order('name');
  if (!data) return;
  listEl.innerHTML = data.map(b => {
    const isActive = b.id === APP.branch.id;
    return `<div onclick="switchBranch('${b.id}','${b.name}',this)"
      style="padding:11px 14px;cursor:pointer;border-radius:2px;margin-bottom:4px;
             background:${isActive ? 'rgba(37,99,235,.1)' : 'var(--navy-800)'};
             border:1px solid ${isActive ? 'rgba(37,99,235,.2)' : 'var(--border)'};
             display:flex;align-items:center;justify-content:space-between;transition:border-color 0.15s"
      onmouseover="if(!this.style.background.includes('37,99,235'))this.style.borderColor='var(--border-2)'"
      onmouseout="if(!this.style.background.includes('37,99,235'))this.style.borderColor='var(--border)'">
      <span style="font-weight:600;color:var(--text-pri)">${b.name}</span>
      <span style="font-family:var(--font-mono);font-size:9px;color:${isActive ? 'var(--accent-bright)' : 'var(--text-muted)'}">${isActive ? 'ACTIVE' : 'SWITCH →'}</span>
    </div>`;
  }).join('');
}

// ═══════════════════════════════════════════════════════════════
// LR CALCULATION ENGINE (preserved from original)
// ═══════════════════════════════════════════════════════════════

const S = {
  freightType: 'variable',
  gstEnabled: false,
  gstPct: 18,
  rowIdx: 1,
};

function fmtINR(n) {
  if (isNaN(n)) return '₹0.00';
  return '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits:2, maximumFractionDigits:2 });
}

function calcRow(inp) {
  const row = inp.closest('tr');
  const w = parseFloat(row.querySelector('[data-w]')?.value) || 0;
  const r = parseFloat(row.querySelector('[data-r]')?.value) || 0;
  const amt = w * r;
  const a = row.querySelector('[data-a]');
  if (a) a.value = fmtINR(amt);
  calcTotal();
}

function calcTotal() {
  let freight = 0;
  if (S.freightType === 'variable') {
    document.querySelectorAll('#lr-tbody tr').forEach(tr => {
      const w = parseFloat(tr.querySelector('[data-w]')?.value) || 0;
      const r = parseFloat(tr.querySelector('[data-r]')?.value) || 0;
      freight += w * r;
    });
  } else {
    freight = parseFloat(document.getElementById('lr-fixed')?.value) || 0;
  }
  const h  = parseFloat(document.getElementById('c-h')?.value) || 0;
  const u  = parseFloat(document.getElementById('c-u')?.value) || 0;
  const sv = parseFloat(document.getElementById('c-s')?.value) || 0;
  const l  = parseFloat(document.getElementById('c-l')?.value) || 0;
  const o  = parseFloat(document.getElementById('c-o')?.value) || 0;
  const extras = h + u + sv + l + o;
  const sub = freight + extras;
  S.gstPct = parseInt(document.getElementById('gst-pct')?.value) || 18;
  const gst = S.gstEnabled ? sub * S.gstPct / 100 : 0;
  const preRound = sub + gst;
  const rnd = Math.round(preRound) - preRound;
  const total = preRound + rnd;
  const $ = id => document.getElementById(id);
  if ($('c-freight')) $('c-freight').textContent = fmtINR(freight);
  if ($('c-hv'))      $('c-hv').textContent      = fmtINR(h);
  if ($('c-uv'))      $('c-uv').textContent      = fmtINR(u);
  if ($('c-sv'))      $('c-sv').textContent      = fmtINR(sv);
  if ($('c-lv'))      $('c-lv').textContent      = fmtINR(l);
  if ($('c-ov'))      $('c-ov').textContent      = fmtINR(o);
  if ($('c-sub'))     $('c-sub').textContent     = fmtINR(sub);
  if ($('c-gpct'))    $('c-gpct').textContent    = S.gstEnabled ? S.gstPct : 0;
  if ($('c-gst'))     $('c-gst').textContent     = fmtINR(gst);
  if ($('c-rnd'))     $('c-rnd').textContent     = (rnd >= 0 ? '+' : '') + fmtINR(Math.abs(rnd));
  if ($('c-total'))   $('c-total').textContent   = fmtINR(total);
}

function addRow() {
  const idx = S.rowIdx++;
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input class="fi" type="text" placeholder="Item description"></td>
    <td><input class="fi" type="number" value="1" min="1" style="width:55px" oninput="calcRow(this)"></td>
    <td><input class="fi" type="number" value="0" step="0.01" style="width:75px" data-w oninput="calcRow(this)"></td>
    <td><input class="fi" type="number" value="0" step="0.01" style="width:75px" data-r oninput="calcRow(this)"></td>
    <td><input class="fi" type="text" value="₹0.00" readonly data-a style="color:var(--accent-bright);font-family:var(--font-mono);font-weight:500"></td>
    <td><div class="rm" onclick="removeRow(this)">✕</div></td>`;
  document.getElementById('lr-tbody').appendChild(tr);
  calcTotal();
}

function removeRow(btn) {
  const rows = document.querySelectorAll('#lr-tbody tr');
  if (rows.length <= 1) { toast('Minimum 1 item required', 'err'); return; }
  btn.closest('tr').remove();
  calcTotal();
}

function setFT(t) {
  S.freightType = t;
  if (t === 'variable') {
    document.getElementById('sec-var').style.display = '';
    document.getElementById('sec-fix').style.display = 'none';
    document.getElementById('btn-var').className = 'btn btn-pri btn-sm';
    document.getElementById('btn-fix').className = 'btn btn-ghost btn-sm';
  } else {
    document.getElementById('sec-var').style.display = 'none';
    document.getElementById('sec-fix').style.display = '';
    document.getElementById('btn-var').className = 'btn btn-ghost btn-sm';
    document.getElementById('btn-fix').className = 'btn btn-pri btn-sm';
  }
  calcTotal();
}

function toggleGST() {
  S.gstEnabled = document.getElementById('gst-tog').checked;
  document.getElementById('gst-opts').style.display = S.gstEnabled ? '' : 'none';
  calcTotal();
}

function switchReport() {
  const val = document.getElementById('reportType')?.value;
  const titles = {
    lr:'LR Register', booking:'Booking Report', manifest:'Manifest Report',
    delivery:'Delivery Report', outstanding:'Outstanding Report',
    daybook:'Daybook Report', cashbook:'Cashbook Report',
    expense:'Expense Report', profit:'Trip Profit Report',
    broker:'Broker Commission Report', branch:'Branch-wise Report', eway:'E-Way Bill Report'
  };
  const el = document.getElementById('reportTitle');
  if (el) el.textContent = (titles[val] || 'Report').toUpperCase();
  if (typeof loadReport === 'function') loadReport();
}

function switchMaster(id, el) {
  const ids = ['branches','parties','drivers','brokers','rates','series','vehicles'];
  ids.forEach(i => { const e = document.getElementById('m-'+i); if(e) e.style.display='none'; });
  const t = document.getElementById('m-'+id);
  if(t) t.style.display='';
  document.querySelectorAll('#masterTabs .tab').forEach(t => t.classList.remove('on'));
  if(el) el.classList.add('on');

  const loaders = {
    branches: () => { if(typeof loadMastersBranches==='function') loadMastersBranches(); },
    parties:  () => { if(typeof loadMastersParties==='function')  loadMastersParties();  },
    drivers:  () => { if(typeof loadMastersDrivers==='function')  loadMastersDrivers();  },
    vehicles: () => { if(typeof loadMastersVehicles==='function') loadMastersVehicles(); },
    brokers:  () => { if(typeof loadMastersBrokers==='function')  loadMastersBrokers();  },
    rates:    () => { if(typeof loadMastersRates==='function')    loadMastersRates();    },
    series:   () => { if(typeof loadMastersSeries==='function')   loadMastersSeries();   },
  };
  if (loaders[id]) loaders[id]();
}

function setPrintTab(type, el) {
  el.closest('.mhd').querySelectorAll('.tab').forEach(t => t.classList.remove('on'));
  el.classList.add('on');
}

function toggleBackupFilters() {
  const t = document.getElementById('backupType').value;
  document.getElementById('backupFilters').style.display = t === 'filtered' ? '' : 'none';
}

// ═══════════════════════════════════════════════════════════════
// APPEARANCE / THEME UI BUILDER
// ═══════════════════════════════════════════════════════════════

function buildThemeUI() {
  const presetGrid = document.getElementById('theme-preset-grid');
  if (!presetGrid) return;

  const presetNames = {
    'midnight-navy':'Midnight Navy','carbon-black':'Carbon Black',
    'forest-green':'Forest Green','deep-purple':'Deep Purple',
    'slate-ocean':'Slate Ocean','crimson-dark':'Crimson Dark',
    'day-mode':'Day Mode','warm-sunset':'Warm Sunset',
  };

  const currentTheme = localStorage.getItem('erp_theme_name') || 'midnight-navy';

  presetGrid.innerHTML = Object.entries(presetNames).map(([key, name]) => {
    const vars = ThemeEngine.presets[key];
    const isActive = key === currentTheme;
    return `
      <div class="theme-card" data-theme="${key}"
           onclick="ThemeEngine.save('${key}', ThemeEngine.presets['${key}'])"
           style="cursor:pointer;border:${isActive ? '1.5px solid var(--accent-bright)' : '1px solid var(--border-2)'};
                  border-radius:3px;overflow:hidden;background:var(--navy-800);position:relative">
        <div style="height:70px;display:flex">
          <div style="width:30%;background:${vars['--navy-950']}"></div>
          <div style="flex:1;background:${vars['--navy-900']};display:flex;align-items:center;justify-content:center">
            <div style="background:${vars['--navy-850']};border-radius:2px;padding:6px 10px">
              <div style="width:8px;height:8px;border-radius:50%;background:${vars['--accent']}"></div>
            </div>
          </div>
        </div>
        <div style="padding:6px 8px;font-family:var(--font-data);font-size:12px;color:var(--text-pri)">${name}</div>
        <div class="theme-badge" style="display:${isActive ? '' : 'none'};position:absolute;top:4px;right:4px;
             background:var(--accent);color:white;font-family:var(--font-mono);font-size:8px;
             padding:1px 5px;border-radius:1px">ACTIVE</div>
      </div>
    `;
  }).join('');
}

// ═══════════════════════════════════════════════════════════════
// DOM READY — BOOT SEQUENCE
// ═══════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', async () => {
  // ── AUTH GUARD: check session before rendering anything ──
  const session = _loadSession();
  if (!session) {
    window.location.href = 'login.html';
    return;
  }
  // Populate APP.user from session
  APP.user = {
    id:        session.id,
    name:      session.name,
    email:     session.email,
    role:      session.role,
    branch_id: session.branch_id,
  };
  // Update sidebar user display
  const nameEl  = document.getElementById('user-name');
  const roleEl  = document.getElementById('user-role');
  const chipEl  = document.getElementById('user-chip');
  if (nameEl) nameEl.textContent = session.name;
  if (roleEl) roleEl.textContent = session.role.toUpperCase();
  if (chipEl) chipEl.textContent = session.name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();

  // Step 1: Apply theme instantly
  ThemeEngine.load();

  // Step 2: Init Supabase
  // config.js is loaded before this file — SUPABASE_URL and SUPABASE_ANON_KEY are guaranteed globals
  if (window.__CONFIG_MISSING && window.__CONFIG_MISSING.length > 0) {
    toast('⚠ Open config.js and paste your Supabase credentials', 'warn');
  } else {
    db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }

  // Step 3-4: Load settings and cache in parallel
  if (db) {
    await Promise.all([
      (async () => {
        if (typeof loadSettings === 'function') await loadSettings();
      })(),
      loadAllMastersCache(),
    ]);
  }

  // Step 5: Populate dropdowns
  populateAllDropdowns();

  // Step 6: Load dashboard
  if (typeof loadDashboard === 'function') loadDashboard();

  // Step 7: Clock
  updateClock();
  setInterval(updateClock, 1000);

  // Dashboard date
  const dd = document.getElementById('dash-date');
  if (dd) dd.textContent = new Date().toLocaleDateString('en-IN', { weekday:'long', day:'numeric', month:'long', year:'numeric' }).toUpperCase() + ' · ' + APP.branch.name;

  // Step 8-9: E-way check and notifications
  if (db) {
    checkEwayExpiry();
    loadNotifications();
    setInterval(loadNotifications, 5 * 60 * 1000);
  }

  // Step 10: Restore page size prefs from localStorage
  Object.keys(APP.pagination).forEach(module => {
    const saved = localStorage.getItem('erp_ps_' + module);
    if (saved) APP.pagination[module].pageSize = parseInt(saved);
  });

  // Build theme UI
  buildThemeUI();

  // Init global search
  initGlobalSearch();

  // Modal overlay close on backdrop click
  document.querySelectorAll('.moverlay').forEach(o => {
    o.addEventListener('click', e => { if (e.target === o) o.classList.remove('on'); });
  });

  // Escape key closes modals
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.moverlay.on').forEach(o => o.classList.remove('on'));
      const notif = document.getElementById('notifPanel');
      if (notif) notif.classList.remove('on');
    }
  });

  // Notification click outside
  document.addEventListener('click', e => {
    if (!e.target.closest('.tb-btn') && !e.target.closest('.notif-panel')) {
      const notif = document.getElementById('notifPanel');
      if (notif) notif.classList.remove('on');
    }
  });

  // Branch modal load on open
  const branchBtn = document.querySelector('[onclick="M(\'branchModal\')"]');
  if (branchBtn) branchBtn.addEventListener('click', loadBranchModal);

  // Initial calc
  calcTotal();

  // Confirm Supabase theme after a brief delay
  if (db) {
    setTimeout(async () => {
      const { data } = await db.from('company_settings').select('ui_theme, ui_custom_colors').limit(1).single();
      if (data?.ui_custom_colors) {
        ThemeEngine.apply(data.ui_custom_colors);
        buildThemeUI();
      }
    }, 1500);
  }
});
