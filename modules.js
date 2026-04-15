// ═══════════════════════════════════════════════════════════════
// FREIGHT ERP PRO — modules.js
// Operational modules: Dashboard, Bookings, LR, Manifest,
// Dispatch, Delivery, Ledger, Payments, Daybook, Expenses,
// E-Way Bills, Reports
// ═══════════════════════════════════════════════════════════════

// Register all page loaders
PAGE_LOADERS['lr']        = () => loadLRRegister();
PAGE_LOADERS['bookings']  = () => loadBookings();
PAGE_LOADERS['manifest']  = () => loadManifest();
PAGE_LOADERS['dispatch']  = () => loadDispatch();
PAGE_LOADERS['delivery']  = () => loadDelivery();
PAGE_LOADERS['payments']  = () => loadPayments();
PAGE_LOADERS['daybook']   = () => loadDaybook(today());
PAGE_LOADERS['expenses']  = () => loadExpenses();
PAGE_LOADERS['eway']      = () => loadEway();
PAGE_LOADERS['reports']   = () => {};
PAGE_LOADERS['dashboard'] = () => loadDashboard();

// Chart instances (destroy before recreate)
let chartLR = null;
let chartStatus = null;

// Delivery state (for auto-open payment modal)
let _deliveryLRId = null;
let _deliveryLR   = null;

// E-way countdown timer
let ewayCountdownInterval = null;

// ═══════════════════════════════════════════════════════════════
// 1. DASHBOARD
// ═══════════════════════════════════════════════════════════════

async function loadDashboard() {
  if (!db) return;
  const todayStr = today();

  try {
    const [
      lrToday, lrInTransit, lrDeliveredToday, lrOutstanding, lrRevenue,
      cashIn, cashOut, ewayStats, topParties, manifestsToday, lrLast7, lrByStatus
    ] = await Promise.all([
      db.from('lorry_receipts').select('id', { count: 'exact', head: true }).eq('lr_date', todayStr),
      db.from('lorry_receipts').select('id', { count: 'exact', head: true }).eq('status', 'in_transit'),
      db.from('lorry_receipts').select('id', { count: 'exact', head: true }).eq('status', 'delivered').eq('delivery_date', todayStr),
      db.from('lorry_receipts').select('total_amount').in('payment_type', ['to_pay', 'credit']).neq('status', 'cancelled'),
      db.from('lorry_receipts').select('total_amount').neq('status', 'cancelled'),
      db.from('payments').select('amount').eq('payment_date', todayStr),
      db.from('expenses').select('amount').eq('expense_date', todayStr),
      db.from('lorry_receipts').select('eway_status, eway_expiry_date').not('eway_bill_no', 'is', null).neq('eway_bill_no', '').neq('status', 'cancelled'),
      db.from('parties').select('name, outstanding_balance').gt('outstanding_balance', 0).order('outstanding_balance', { ascending: false }).limit(5),
      db.from('manifests').select('id', { count: 'exact', head: true }).eq('status', 'dispatched').gte('dispatch_time', todayStr + 'T00:00:00'),
      db.from('lorry_receipts').select('lr_date').gte('lr_date', new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)).order('lr_date'),
      db.from('lorry_receipts').select('status').neq('status', 'cancelled'),
    ]);

    // KPI calculations
    const outstanding = (lrOutstanding.data || []).reduce((s, r) => s + parseFloat(r.total_amount || 0), 0);
    const revenue     = (lrRevenue.data || []).reduce((s, r) => s + parseFloat(r.total_amount || 0), 0);
    const todayCashIn = (cashIn.data || []).reduce((s, r) => s + parseFloat(r.amount || 0), 0);
    const todayCashOut= (cashOut.data || []).reduce((s, r) => s + parseFloat(r.amount || 0), 0);

    // Update KPI tiles
    setHTML('kpi-lr-count',      num(lrToday.count || 0));
    setHTML('kpi-delivered',     num(lrDeliveredToday.count || 0));
    setHTML('kpi-in-transit',    num(lrInTransit.count || 0));
    setHTML('kpi-revenue',       numCompact(revenue));
    setHTML('kpi-outstanding',   numCompact(outstanding));

    // Active trips = unique vehicles in transit
    setHTML('kpi-trips',         num(lrInTransit.count || 0));

    // Today summary
    setHTML('dash-lr-today',     num(lrToday.count || 0));
    setHTML('dash-delivered-today', num(lrDeliveredToday.count || 0));
    setHTML('dash-manifests-today', num(manifestsToday.count || 0));
    setHTML('dash-cash-in',      '₹' + num(todayCashIn));
    setHTML('dash-cash-out',     '₹' + num(todayCashOut));
    setHTML('dash-net',          '₹' + num(todayCashIn - todayCashOut));

    // E-Way status
    const ewayData = ewayStats.data || [];
    let ewayValid = 0, ewayExpiring = 0, ewayExpired = 0;
    ewayData.forEach(r => {
      if (!r.eway_expiry_date) return;
      const diff = new Date(r.eway_expiry_date) - new Date(todayStr);
      if (diff < 0) ewayExpired++;
      else if (diff <= 86400000) ewayExpiring++;
      else ewayValid++;
    });
    setHTML('eway-valid',    num(ewayValid));
    setHTML('eway-expiring', num(ewayExpiring));
    setHTML('eway-expired',  num(ewayExpired));

    // Top outstanding parties
    const partyEl = document.getElementById('dash-outstanding-parties');
    if (partyEl && topParties.data) {
      if (topParties.data.length === 0) {
        partyEl.innerHTML = '<div style="padding:12px;text-align:center;font-size:11.5px;color:var(--text-muted)">No outstanding amounts</div>';
      } else {
        partyEl.innerHTML = topParties.data.map(p => `
          <div class="row sb" style="padding:6px 0;border-bottom:1px solid var(--border)">
            <span style="font-size:11.5px;color:var(--text-sec)">${p.name}</span>
            <span style="font-family:var(--font-mono);color:#f87171;font-size:11.5px">₹${num(p.outstanding_balance)}</span>
          </div>`).join('');
      }
    }

    // Charts
    _buildDashCharts(lrLast7.data || [], lrByStatus.data || []);

    // Recent LRs (dashboard table)
    const { data: recentLRs } = await db.from('lorry_receipts')
      .select('lr_number, lr_date, consignor:consignor_id(name), consignee:consignee_id(name), vehicle_no, payment_type, total_amount, status')
      .order('created_at', { ascending: false }).limit(10);

    const dashTbody = document.getElementById('dash-recent-lr');
    if (dashTbody && recentLRs) {
      if (recentLRs.length === 0) {
        dashTbody.innerHTML = '<tr><td colspan="9" class="empty"><div class="empty-ico">📋</div><div class="empty-txt">No LRs yet</div></td></tr>';
      } else {
        dashTbody.innerHTML = recentLRs.map(lr => `
          <tr>
            <td class="td-id" onclick="viewLR_byNumber('${lr.lr_number}')">${lr.lr_number}</td>
            <td class="td-muted">${formatDate(lr.lr_date)}</td>
            <td class="td-pri">${lr.consignor?.name || '—'}</td>
            <td>${lr.consignee?.name || '—'}</td>
            <td class="td-muted" style="font-family:var(--font-mono);font-size:11px">${lr.vehicle_no}</td>
            <td><span class="tag tag-${paymentTag(lr.payment_type)}">${slugToLabel(lr.payment_type)}</span></td>
            <td class="td-num r">₹${num(lr.total_amount)}</td>
            <td><span class="tag tag-${statusTag(lr.status)}">${slugToLabel(lr.status)}</span></td>
          </tr>`).join('');
      }
    }

    // Update dashboard date
    const dd = document.getElementById('dash-date');
    if (dd) dd.textContent = new Date().toLocaleDateString('en-IN', { weekday:'long', day:'numeric', month:'long', year:'numeric' }).toUpperCase() + ' · ' + APP.branch.name;

  } catch(e) {
    console.error('Dashboard load error:', e);
    toast('Dashboard load failed', 'err');
  }
}

function _buildDashCharts(lrLast7, lrByStatus) {
  // Bar chart: LR count per day last 7 days
  const last7 = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    last7.push(d);
  }
  const countByDay = {};
  last7.forEach(d => { countByDay[d] = 0; });
  lrLast7.forEach(r => { if (countByDay[r.lr_date] !== undefined) countByDay[r.lr_date]++; });

  const ctx1 = document.getElementById('dash-chart-lr');
  if (ctx1) {
    if (chartLR) { chartLR.destroy(); chartLR = null; }
    chartLR = new Chart(ctx1, {
      type: 'bar',
      data: {
        labels: last7.map(d => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day:'numeric', month:'short' })),
        datasets: [{ label: 'LRs', data: last7.map(d => countByDay[d]),
          backgroundColor: 'rgba(37,99,235,0.7)', borderColor: '#3b82f6', borderWidth: 1, borderRadius: 2 }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
        scales: { x: { grid: { display: false }, ticks: { color: '#8fa8c8', font: { size: 10 } } },
                  y: { grid: { color: 'rgba(143,168,200,0.08)' }, ticks: { color: '#8fa8c8', font: { size: 10 } } } } }
    });
  }

  // Donut chart: LR by status
  const statusCounts = {};
  lrByStatus.forEach(r => { statusCounts[r.status] = (statusCounts[r.status] || 0) + 1; });
  const statusLabels = Object.keys(statusCounts);
  const statusColors = { booked:'#3b82f6', in_transit:'#fbbf24', delivered:'#4ade80', partial:'#fb923c', cancelled:'#f87171' };

  const ctx2 = document.getElementById('dash-chart-status');
  if (ctx2 && statusLabels.length > 0) {
    if (chartStatus) { chartStatus.destroy(); chartStatus = null; }
    chartStatus = new Chart(ctx2, {
      type: 'doughnut',
      data: {
        labels: statusLabels.map(s => slugToLabel(s)),
        datasets: [{ data: statusLabels.map(s => statusCounts[s]),
          backgroundColor: statusLabels.map(s => statusColors[s] || '#8fa8c8'), borderWidth: 0 }]
      },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'right', labels: { color: '#8fa8c8', font: { size: 10 } } } } }
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// 2. BOOKINGS
// ═══════════════════════════════════════════════════════════════

async function loadBookings() {
  if (!db) return;
  showTableSkeleton('bookings-tbody', 10);
  const { page, pageSize } = APP.pagination.bookings;
  const from = (page - 1) * pageSize, to = from + pageSize - 1;

  const statusFilter = getVal('bk-filter-status');
  const searchQ      = getVal('bk-filter-search');
  const fromDate     = getVal('bk-filter-from');
  const toDate       = getVal('bk-filter-to');
  const branchFilter = getVal('bk-filter-branch');

  let q = db.from('bookings')
    .select('*, consignor:consignor_id(name), consignee:consignee_id(name), branch:branch_id(name)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (statusFilter) q = q.eq('status', statusFilter);
  if (fromDate)     q = q.gte('booking_date', fromDate);
  if (toDate)       q = q.lte('booking_date', toDate);
  if (branchFilter) q = q.eq('branch_id', branchFilter);
  if (searchQ)      q = q.ilike('booking_no', `%${searchQ}%`);

  const { data, count, error } = await q;
  APP.pagination.bookings.total = count || 0;

  const tbody = document.getElementById('bookings-tbody');
  if (error) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="10" class="empty"><div class="empty-txt">Failed to load bookings</div></td></tr>`;
    toast('Failed to load bookings: ' + error.message, 'err');
    return;
  }

  if (!data || data.length === 0) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="10" class="empty"><div class="empty-ico">📋</div><div class="empty-txt">No bookings found</div><div class="empty-sub">Adjust filters or create a new booking</div></td></tr>`;
  } else {
    tbody.innerHTML = data.map(b => {
      const actions = b.status === 'pending'
        ? `<button class="btn btn-pri btn-xs" onclick="openLRFromBooking('${b.id}')">CREATE LR</button>
           <button class="btn btn-ghost btn-xs" onclick="editBooking('${b.id}')">EDIT</button>
           <button class="btn btn-danger btn-xs" onclick="cancelBooking('${b.id}','${b.booking_no}')">CANCEL</button>`
        : b.status === 'lr_created'
        ? `<button class="btn btn-ghost btn-xs" onclick="go('lr',null)">VIEW LR</button>
           <button class="btn btn-ghost btn-xs" onclick="editBooking('${b.id}')">EDIT</button>`
        : `<span class="tag tag-cancelled">CANCELLED</span>`;
      return `<tr>
        <td class="td-id">${b.booking_no}</td>
        <td class="td-muted">${formatDate(b.booking_date)}</td>
        <td class="td-pri">${b.consignor?.name || '—'}</td>
        <td>${b.consignee?.name || '—'}</td>
        <td>${b.from_city}</td><td>${b.to_city}</td>
        <td class="td-muted">${b.branch?.name || '—'}</td>
        <td class="td-muted">${APP.user.name}</td>
        <td><span class="tag tag-${statusTag(b.status)}">${slugToLabel(b.status)}</span></td>
        <td><div class="row gap14">${actions}</div></td>
      </tr>`;
    }).join('');
  }
  renderPagination('pag-bookings', 'bookings');
}

async function saveBooking() {
  const btn = document.querySelector('#bookingModal .btn-pri');
  const consignorId = document.querySelector('#bookingModal .sel-consignor')?.value;
  const consigneeId = document.querySelector('#bookingModal .sel-consignee')?.value;
  const fromCity    = getVal('bk-from-city');
  const toCity      = getVal('bk-to-city');
  const bookingDate = getVal('bk-date') || today();
  const branchId    = document.querySelector('#bookingModal .sel-branch')?.value || APP.branch.id;

  if (!consignorId) { toast('Consignor is required', 'err'); return; }
  if (!consigneeId) { toast('Consignee is required', 'err'); return; }
  if (!fromCity)    { toast('From city is required', 'err'); return; }
  if (!toCity)      { toast('To city is required', 'err'); return; }

  setBtnLoading(btn, true, 'SAVING...');
  try {
    const booking_no = await getNextNumber('booking');
    const { data, error } = await db.from('bookings').insert({
      booking_no, booking_date: bookingDate, branch_id: branchId,
      consignor_id: consignorId, consignee_id: consigneeId,
      from_city: fromCity, to_city: toCity, status: 'pending',
      created_by: APP.user.id
    }).select().single();

    if (error) throw error;
    auditLog('CREATE', 'booking', data.id, booking_no);
    toast('Booking ' + booking_no + ' created', 'ok');
    C('bookingModal');
    resetPage('bookings');
    loadBookings();
  } catch(e) {
    toast('Failed to save booking: ' + e.message, 'err');
  } finally {
    setBtnLoading(btn, false);
  }
}

async function cancelBooking(id, bookingNo) {
  const ok = await confirmAction(`Cancel booking ${bookingNo}? This cannot be undone.`);
  if (!ok) return;
  const { error } = await db.from('bookings').update({ status: 'cancelled' }).eq('id', id);
  if (error) { toast('Failed to cancel: ' + error.message, 'err'); return; }
  auditLog('CANCEL', 'booking', id, bookingNo);
  toast('Booking cancelled', 'ok');
  loadBookings();
}

function openLRFromBooking(bookingId) {
  const booking = null; // Will be fetched
  db.from('bookings').select('*, consignor:consignor_id(name,id), consignee:consignee_id(name,id)')
    .eq('id', bookingId).single().then(({ data }) => {
      if (data) {
        document.getElementById('lr-booking-id').value = data.id;
        const consEl = document.querySelector('#lrModal .sel-consignor');
        const ceeEl  = document.querySelector('#lrModal .sel-consignee');
        if (consEl) consEl.value = data.consignor_id;
        if (ceeEl)  ceeEl.value  = data.consignee_id;
        setVal('lr-from-city', data.from_city);
        setVal('lr-to-city', data.to_city);
      }
      openLRModal();
    });
}

async function editBooking(id) {
  const { data } = await db.from('bookings').select('*').eq('id', id).single();
  if (!data) return;
  setVal('bk-date', data.booking_date);
  setVal('bk-from-city', data.from_city);
  setVal('bk-to-city', data.to_city);
  const consEl = document.querySelector('#bookingModal .sel-consignor');
  const ceeEl  = document.querySelector('#bookingModal .sel-consignee');
  const brEl   = document.querySelector('#bookingModal .sel-branch');
  if (consEl) consEl.value = data.consignor_id;
  if (ceeEl)  ceeEl.value  = data.consignee_id;
  if (brEl)   brEl.value   = data.branch_id;
  document.getElementById('bk-edit-id').value = id;
  M('bookingModal');
}

// ═══════════════════════════════════════════════════════════════
// 3. LORRY RECEIPTS
// ═══════════════════════════════════════════════════════════════

let _lrDraftTimer = null;

async function loadLRRegister() {
  if (!db) return;
  showTableSkeleton('lr-tbody-main', 13);
  const { page, pageSize } = APP.pagination.lr;
  const from = (page - 1) * pageSize, to = from + pageSize - 1;

  const statusFilter  = getVal('lr-filter-status');
  const payFilter     = getVal('lr-filter-pay');
  const fromDate      = getVal('lr-filter-from');
  const toDate        = getVal('lr-filter-to');
  const branchFilter  = getVal('lr-filter-branch');
  const searchQ       = getVal('lr-filter-search');

  let q = db.from('lorry_receipts')
    .select('*, consignor:consignor_id(name), consignee:consignee_id(name)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (statusFilter) q = q.eq('status', statusFilter);
  if (payFilter)    q = q.eq('payment_type', payFilter);
  if (fromDate)     q = q.gte('lr_date', fromDate);
  if (toDate)       q = q.lte('lr_date', toDate);
  if (branchFilter) q = q.eq('branch_id', branchFilter);
  if (searchQ)      q = q.or(`lr_number.ilike.%${searchQ}%,vehicle_no.ilike.%${searchQ}%`);

  const { data, count, error } = await q;
  APP.pagination.lr.total = count || 0;

  const tbody = document.getElementById('lr-tbody-main');
  if (error) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="13" class="empty"><div class="empty-txt">Failed to load LRs</div></td></tr>`;
    toast('Failed to load LRs: ' + error.message, 'err'); return;
  }

  // Update subtitle
  setHTML('lr-subtitle', `LR REGISTER · ${num(count || 0)} RECORDS`);

  if (!data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="13" class="empty"><div class="empty-ico">📄</div><div class="empty-txt">No LRs found</div><div class="empty-sub">Adjust filters or create a new LR</div></td></tr>`;
  } else {
    tbody.innerHTML = data.map(lr => `
      <tr>
        <td><input type="checkbox" class="lr-sel" data-id="${lr.id}" onchange="updateBulkBar()"></td>
        <td class="td-id" onclick="viewLR('${lr.id}')">${lr.lr_number}</td>
        <td class="td-muted">${formatDate(lr.lr_date)}</td>
        <td class="td-pri">${lr.consignor?.name || '—'}</td>
        <td>${lr.consignee?.name || '—'}</td>
        <td class="td-muted">${lr.from_city}→${lr.to_city}</td>
        <td style="font-family:var(--font-mono);font-size:11px">${lr.vehicle_no}</td>
        <td><span class="tag tag-${lr.freight_type === 'fixed' ? 'draft' : 'booked'}">${capitalize(lr.freight_type)}</span></td>
        <td><span class="tag tag-${paymentTag(lr.payment_type)}">${slugToLabel(lr.payment_type)}</span></td>
        <td class="td-num r">₹${num(lr.freight_amount)}</td>
        <td class="td-num r">₹${num(lr.total_amount)}</td>
        <td><span class="tag tag-${lr.eway_bill_no ? _ewayStatusClass(lr.eway_expiry_date) : 'locked'}">${lr.eway_bill_no ? _ewayStatusLabel(lr.eway_expiry_date) : 'NONE'}</span></td>
        <td><span class="tag tag-${statusTag(lr.status)}">${slugToLabel(lr.status)}</span></td>
        <td><div class="row gap14">
          <button class="btn btn-ghost btn-xs" onclick="viewLR('${lr.id}')">VIEW</button>
          <button class="btn btn-ghost btn-xs" onclick="openPrintModal('${lr.id}')">PRINT</button>
          ${lr.status !== 'cancelled' && lr.status !== 'delivered' ? `<button class="btn btn-danger btn-xs" onclick="cancelLR('${lr.id}','${lr.lr_number}','${lr.payment_type}',${lr.total_amount})">CANCEL</button>` : ''}
        </div></td>
      </tr>`).join('');
  }

  // Totals bar
  if (data && data.length > 0) {
    const totFreight = data.reduce((s, r) => s + parseFloat(r.freight_amount || 0), 0);
    const totGst     = data.reduce((s, r) => s + parseFloat(r.gst_amount || 0), 0);
    const totAmt     = data.reduce((s, r) => s + parseFloat(r.total_amount || 0), 0);
    setHTML('lr-tot-records', num(count || 0));
    setHTML('lr-tot-freight', '₹' + num(totFreight));
    setHTML('lr-tot-gst',     '₹' + num(totGst));
    setHTML('lr-tot-amount',  '₹' + num(totAmt));
  }

  renderPagination('pag-lr', 'lr');
}

function _ewayStatusClass(expiryDate) {
  if (!expiryDate) return 'locked';
  const diff = new Date(expiryDate) - new Date(today());
  if (diff < 0) return 'expired';
  if (diff <= 86400000) return 'expiring';
  return 'valid';
}
function _ewayStatusLabel(expiryDate) {
  if (!expiryDate) return 'NONE';
  const diff = new Date(expiryDate) - new Date(today());
  if (diff < 0) return 'EXPIRED';
  if (diff <= 86400000) return 'EXPIRING';
  return 'VALID';
}

async function openLRModal() {
  // Pre-fill date
  const dateEl = document.getElementById('lr-date');
  if (dateEl) dateEl.value = today();

  // Get next LR number
  const nextNum = await getNextNumber('lr');
  const subEl = document.querySelector('#lrModal .mhd-sub');
  if (subEl) subEl.textContent = 'AUTO NO: ' + nextNum;
  document.getElementById('lr-next-number').value = nextNum;

  // Check for draft
  const draft = localStorage.getItem('erp_lr_draft');
  if (draft) {
    const resume = await confirmAction('You have an unsaved LR draft. Resume it?');
    if (resume) {
      try { _populateLRFromDraft(JSON.parse(draft)); }
      catch(e) { clearLRDraft(); }
    } else {
      clearLRDraft();
    }
  }

  // Wire draft auto-save
  const modal = document.getElementById('lrModal');
  if (modal) {
    modal.querySelectorAll('input,select,textarea').forEach(el => {
      el.addEventListener('input', _scheduleLRDraft);
      el.addEventListener('change', _scheduleLRDraft);
    });
  }

  M('lrModal');
}

function _scheduleLRDraft() {
  clearTimeout(_lrDraftTimer);
  _lrDraftTimer = setTimeout(_saveLRDraft, 30000);
}

function _saveLRDraft() {
  const draft = {
    consignor_id: document.querySelector('#lrModal .sel-consignor')?.value,
    consignee_id: document.querySelector('#lrModal .sel-consignee')?.value,
    lr_date: getVal('lr-date'),
    vehicle_no: getVal('lr-veh'),
    driver_id: document.getElementById('lr-drv')?.value,
    payment_type: document.getElementById('lr-pay')?.value,
    from_city: getVal('lr-from-city'),
    to_city: getVal('lr-to-city'),
  };
  localStorage.setItem('erp_lr_draft', JSON.stringify(draft));
}

function clearLRDraft() {
  localStorage.removeItem('erp_lr_draft');
  clearTimeout(_lrDraftTimer);
}

function _populateLRFromDraft(draft) {
  const consEl = document.querySelector('#lrModal .sel-consignor');
  const ceeEl  = document.querySelector('#lrModal .sel-consignee');
  if (consEl) consEl.value = draft.consignor_id || '';
  if (ceeEl)  ceeEl.value  = draft.consignee_id || '';
  setVal('lr-date', draft.lr_date);
  setVal('lr-veh',  draft.vehicle_no);
  if (document.getElementById('lr-drv')) document.getElementById('lr-drv').value = draft.driver_id || '';
  if (document.getElementById('lr-pay')) document.getElementById('lr-pay').value  = draft.payment_type || 'to_pay';
  setVal('lr-from-city', draft.from_city);
  setVal('lr-to-city',   draft.to_city);
}

// Credit check on consignee change
function checkConsigneeCredit() {
  const ceeEl = document.querySelector('#lrModal .sel-consignee');
  if (!ceeEl) return;
  const partyId = ceeEl.value;
  const party = APP.cache.parties.find(p => p.id === partyId);
  const warnEl = document.getElementById('lr-credit-warn');
  const saveBtn = document.querySelector('#lrModal .btn-pri[onclick="saveLR()"]');
  if (!warnEl || !party || party.credit_limit <= 0) {
    if (warnEl) warnEl.style.display = 'none';
    return;
  }
  const ratio = party.outstanding_balance / party.credit_limit;
  if (ratio >= 1) {
    warnEl.className = 'alert alert-e';
    warnEl.innerHTML = `<strong>CREDIT LIMIT EXCEEDED</strong> ${party.name} — ₹${num(party.outstanding_balance)} of ₹${num(party.credit_limit)} limit used.`;
    warnEl.style.display = '';
    if (saveBtn && APP.user.role !== 'admin') saveBtn.disabled = true;
  } else if (ratio >= 0.9) {
    warnEl.className = 'alert alert-w';
    warnEl.innerHTML = `<strong>CREDIT WARNING</strong> ${party.name} — ${Math.round(ratio*100)}% of credit limit utilized.`;
    warnEl.style.display = '';
    if (saveBtn) saveBtn.disabled = false;
  } else {
    warnEl.style.display = 'none';
    if (saveBtn) saveBtn.disabled = false;
  }
}

// Rate auto-fill
function autoFillRate() {
  const fromCity = getVal('lr-from-city');
  const toCity   = getVal('lr-to-city');
  if (!fromCity || !toCity) return;
  const rate = APP.cache.rates.find(r =>
    r.from_city.toLowerCase() === fromCity.toLowerCase() &&
    r.to_city.toLowerCase() === toCity.toLowerCase()
  );
  if (rate) {
    document.querySelectorAll('#lr-tbody [data-r]').forEach(el => {
      if (!el.value || el.value === '0') el.value = rate.rate_per_kg;
    });
    calcTotal();
    toast('Rate auto-filled: ₹' + rate.rate_per_kg + '/kg', 'ok');
  }
}

async function saveLR() {
  const consEl = document.querySelector('#lrModal .sel-consignor');
  const ceeEl  = document.querySelector('#lrModal .sel-consignee');
  const broEl  = document.querySelector('#lrModal .sel-broker');

  const consignorId = consEl?.value;
  const consigneeId = ceeEl?.value;
  const fromCity    = getVal('lr-from-city');
  const toCity      = getVal('lr-to-city');
  const vehicleNo   = getVal('lr-veh');
  const lrDate      = getVal('lr-date') || today();

  if (!consignorId) { toast('Consignor is required', 'err'); return; }
  if (!consigneeId) { toast('Consignee is required', 'err'); return; }
  if (!fromCity)    { toast('From city is required', 'err'); return; }
  if (!toCity)      { toast('To city is required', 'err'); return; }
  if (!vehicleNo)   { toast('Vehicle number is required', 'err'); return; }

  // Duplicate detection
  const { data: dupes } = await db.from('lorry_receipts')
    .select('id').eq('vehicle_no', vehicleNo).eq('lr_date', lrDate).eq('consignor_id', consignorId).limit(1);
  if (dupes && dupes.length > 0) {
    const ok = await confirmAction('Possible duplicate LR detected (same vehicle, date, consignor). Continue?');
    if (!ok) return;
  }

  const btn = document.querySelector('#lrModal .btn-pri[onclick="saveLR()"]');
  setBtnLoading(btn, true, 'SAVING...');

  try {
    const lr_number  = document.getElementById('lr-next-number')?.value || await getNextNumber('lr');
    const driverId   = document.getElementById('lr-drv')?.value || null;
    const payType    = document.getElementById('lr-pay')?.value || 'to_pay';
    const brokerId   = broEl?.value || null;
    const bookingId  = getVal('lr-booking-id') || null;
    const ewayBillNo = getVal('lr-eway-no');
    const ewayExpiry = getVal('lr-eway-expiry');
    const ewayIssue  = getVal('lr-eway-issue');
    const freightAmt = parseFloat(document.getElementById('c-freight')?.textContent?.replace(/[₹,]/g,'') || 0);
    const gstAmt     = parseFloat(document.getElementById('c-gst')?.textContent?.replace(/[₹,]/g,'') || 0);
    const roundOff   = parseFloat(document.getElementById('c-rnd')?.textContent?.replace(/[₹+,]/g,'') || 0);
    const totalAmt   = parseFloat(document.getElementById('c-total')?.textContent?.replace(/[₹,]/g,'') || 0);
    const subTotal   = parseFloat(document.getElementById('c-sub')?.textContent?.replace(/[₹,]/g,'') || 0);
    const hamali     = parseFloat(document.getElementById('c-h')?.value || 0);
    const unloading  = parseFloat(document.getElementById('c-u')?.value || 0);
    const stCharge   = parseFloat(document.getElementById('c-s')?.value || 0);
    const lrCharge   = parseFloat(document.getElementById('c-l')?.value || 0);
    const otherChg   = parseFloat(document.getElementById('c-o')?.value || 0);
    const gstEnabled = document.getElementById('gst-tog')?.checked || false;
    const gstPct     = parseInt(document.getElementById('gst-pct')?.value || 18);
    const showAmt    = document.getElementById('show-amt')?.checked !== false;
    const freightType = S.freightType || 'variable';
    const fixedAmt   = parseFloat(document.getElementById('lr-fixed')?.value || 0);

    // Compute weight from table rows + collect goods_items
    let totalWeight = 0;
    const goods_items = [];
    document.querySelectorAll('#lr-tbody tr').forEach(tr => {
      const desc   = tr.querySelector('td:first-child input')?.value?.trim() || '';
      const pkgs   = parseFloat(tr.querySelector('td:nth-child(2) input')?.value || 1);
      const weight = parseFloat(tr.querySelector('[data-w]')?.value || 0);
      const rate   = parseFloat(tr.querySelector('[data-r]')?.value || 0);
      const amount = parseFloat(tr.querySelector('[data-a]')?.value?.replace(/[₹,]/g,'') || 0);
      totalWeight += weight;
      if (desc || weight > 0) goods_items.push({ desc, pkgs, weight, rate, amount });
    });
    // Also build a single goods_desc string for backwards compatibility / view modal
    const goods_desc = goods_items.map(g => g.desc).filter(Boolean).join(', ');

    // Eway status
    let ewayStatus = 'none';
    if (ewayBillNo && ewayExpiry) {
      const diff = new Date(ewayExpiry) - new Date(today());
      if (diff < 0) ewayStatus = 'expired';
      else if (diff <= 86400000) ewayStatus = 'expiring';
      else ewayStatus = 'valid';
    }

    const { data, error } = await db.from('lorry_receipts').insert({
      lr_number, lr_date: lrDate, booking_id: bookingId || null,
      branch_id: APP.branch.id, consignor_id: consignorId, consignee_id: consigneeId,
      from_city: fromCity, to_city: toCity, vehicle_no: vehicleNo.toUpperCase(),
      driver_id: driverId || null, broker_id: brokerId || null,
      freight_type: freightType, fixed_amount: fixedAmt,
      freight_amount: freightAmt, hamali, unloading,
      st_charge: stCharge, lr_charge: lrCharge, other_charges: otherChg,
      subtotal: subTotal, gst_enabled: gstEnabled, gst_pct: gstPct,
      gst_amount: gstAmt, round_off: roundOff, total_amount: totalAmt,
      payment_type: payType, weight_kg: totalWeight,
      eway_bill_no: ewayBillNo || null, eway_expiry_date: ewayExpiry || null,
      eway_status: ewayStatus, status: 'booked',
      show_amount_on_print: showAmt, created_by: APP.user.id,
      goods_items: goods_items.length ? goods_items : null,
      goods_desc: goods_desc || null
    }).select().single();

    if (error) throw error;

    // Update party outstanding for to_pay / credit
    if (['to_pay','credit'].includes(payType)) {
      const party = APP.cache.parties.find(p => p.id === consigneeId);
      if (party) {
        await db.from('parties').update({
          outstanding_balance: (parseFloat(party.outstanding_balance) || 0) + totalAmt
        }).eq('id', consigneeId);
        party.outstanding_balance = (parseFloat(party.outstanding_balance) || 0) + totalAmt;
      }
    }

    // Update booking status
    if (bookingId) {
      await db.from('bookings').update({ status: 'lr_created' }).eq('id', bookingId);
    }

    auditLog('CREATE', 'lr', data.id, lr_number);
    clearLRDraft();
    toast('LR ' + lr_number + ' saved successfully', 'ok');
    C('lrModal');
    goToPage('lr', 1);
    loadDashboard();
  } catch(e) {
    toast('Failed to save LR: ' + e.message, 'err');
  } finally {
    setBtnLoading(btn, false);
  }
}

async function viewLR(id) {
  if (!db) return;
  const { data: lr, error } = await db.from('lorry_receipts')
    .select('*, consignor:consignor_id(name), consignee:consignee_id(name), driver:driver_id(name)')
    .eq('id', id).single();
  if (error || !lr) { toast('Failed to load LR', 'err'); return; }

  // Populate view modal
  const mhd = document.querySelector('#lrViewModal .mhd-title');
  const sub  = document.querySelector('#lrViewModal .mhd-sub');
  if (mhd) mhd.textContent = lr.lr_number;
  if (sub) sub.textContent = formatDate(lr.lr_date) + ' · ' + (lr.from_city + '→' + lr.to_city).toUpperCase() + ' · ' + slugToLabel(lr.status).toUpperCase();

  const body = document.querySelector('#lrViewModal .mbody');
  if (body) {
    body.innerHTML = `
      <div class="fgrid g4" style="gap:1px;margin-bottom:14px">
        <div class="inlinebox"><div style="font-family:var(--font-mono);font-size:8px;letter-spacing:1.5px;text-transform:uppercase;color:var(--text-muted);margin-bottom:5px">Consignor</div><div style="font-weight:600;color:var(--text-pri)">${lr.consignor?.name || '—'}</div></div>
        <div class="inlinebox"><div style="font-family:var(--font-mono);font-size:8px;letter-spacing:1.5px;text-transform:uppercase;color:var(--text-muted);margin-bottom:5px">Consignee</div><div style="font-weight:600;color:var(--text-pri)">${lr.consignee?.name || '—'}</div></div>
        <div class="inlinebox"><div style="font-family:var(--font-mono);font-size:8px;letter-spacing:1.5px;text-transform:uppercase;color:var(--text-muted);margin-bottom:5px">Route</div><div style="font-weight:600;color:var(--text-pri)">${lr.from_city} → ${lr.to_city}</div></div>
        <div class="inlinebox"><div style="font-family:var(--font-mono);font-size:8px;letter-spacing:1.5px;text-transform:uppercase;color:var(--text-muted);margin-bottom:5px">Vehicle</div><div style="font-weight:600;color:var(--text-pri);font-family:var(--font-mono)">${lr.vehicle_no}</div></div>
        <div class="inlinebox"><div style="font-family:var(--font-mono);font-size:8px;letter-spacing:1.5px;text-transform:uppercase;color:var(--text-muted);margin-bottom:5px">Driver</div><div style="font-weight:600;color:var(--text-pri)">${lr.driver?.name || '—'}</div></div>
        <div class="inlinebox"><div style="font-family:var(--font-mono);font-size:8px;letter-spacing:1.5px;text-transform:uppercase;color:var(--text-muted);margin-bottom:5px">Payment</div><div style="font-weight:600;color:var(--text-pri)"><span class="tag tag-${paymentTag(lr.payment_type)}">${slugToLabel(lr.payment_type)}</span></div></div>
        <div class="inlinebox"><div style="font-family:var(--font-mono);font-size:8px;letter-spacing:1.5px;text-transform:uppercase;color:var(--text-muted);margin-bottom:5px">Status</div><div><span class="tag tag-${statusTag(lr.status)}">${slugToLabel(lr.status)}</span></div></div>
        <div class="inlinebox"><div style="font-family:var(--font-mono);font-size:8px;letter-spacing:1.5px;text-transform:uppercase;color:var(--text-muted);margin-bottom:5px">E-Way Bill</div><div style="font-family:var(--font-mono);font-weight:600;color:var(--text-pri)">${lr.eway_bill_no || '—'}</div></div>
      </div>
      <div style="display:flex;justify-content:flex-end">
        <div class="calc" style="width:280px">
          <div class="calc-row"><span class="calc-lbl">Freight</span><span class="calc-val">₹${num(lr.freight_amount)}</span></div>
          ${lr.hamali > 0 ? `<div class="calc-row"><span class="calc-lbl">Hamali</span><span class="calc-val">₹${num(lr.hamali)}</span></div>` : ''}
          ${lr.gst_amount > 0 ? `<div class="calc-row"><span class="calc-lbl">GST ${lr.gst_pct}%</span><span class="calc-val">₹${num(lr.gst_amount)}</span></div>` : ''}
          <div class="calc-total-row"><span class="calc-total-lbl">TOTAL AMOUNT</span><span class="calc-total-val">₹${num(lr.total_amount)}</span></div>
        </div>
      </div>
      ${lr.goods_desc ? `<div class="inlinebox" style="margin-top:12px"><label style="font-family:var(--font-mono);font-size:8.5px;letter-spacing:1.5px;text-transform:uppercase;color:var(--text-muted)">GOODS DESCRIPTION</label><div style="margin-top:4px;color:var(--text-pri)">${lr.goods_desc}</div></div>` : ''}
    `;
  }

  // Wire print button
  const printBtn = document.querySelector('#lrViewModal .btn-ghost');
  if (printBtn) printBtn.onclick = () => { C('lrViewModal'); openPrintModal(id); };

  M('lrViewModal');
}

async function viewLR_byNumber(lrNumber) {
  if (!db) return;
  const { data } = await db.from('lorry_receipts').select('id').eq('lr_number', lrNumber).single();
  if (data) viewLR(data.id);
}

async function cancelLR(id, lrNumber, paymentType, totalAmount) {
  const ok = await confirmAction(`Cancel LR ${lrNumber}? This action cannot be undone.`);
  if (!ok) return;

  const { error } = await db.from('lorry_receipts').update({ status: 'cancelled' }).eq('id', id);
  if (error) { toast('Failed to cancel LR: ' + error.message, 'err'); return; }

  if (['to_pay','credit'].includes(paymentType)) {
    const { data: lr } = await db.from('lorry_receipts').select('consignee_id').eq('id', id).single();
    if (lr) {
      const party = APP.cache.parties.find(p => p.id === lr.consignee_id);
      if (party) {
        const newBal = Math.max(0, (parseFloat(party.outstanding_balance) || 0) - parseFloat(totalAmount));
        await db.from('parties').update({ outstanding_balance: newBal }).eq('id', party.id);
        party.outstanding_balance = newBal;
      }
    }
  }

  auditLog('CANCEL', 'lr', id, lrNumber);
  toast('LR ' + lrNumber + ' cancelled', 'ok');
  loadLRRegister();
}

async function exportLRCSV() {
  if (!db) { toast('Not connected', 'err'); return; }
  toast('Fetching all records for export...', 'i');

  const statusFilter = getVal('lr-filter-status');
  const searchQ      = getVal('lr-filter-search');
  const fromDate     = getVal('lr-filter-from');
  const toDate       = getVal('lr-filter-to');

  let q = db.from('lorry_receipts')
    .select('lr_number,lr_date,vehicle_no,from_city,to_city,payment_type,freight_amount,total_amount,status')
    .order('lr_date', { ascending: false });
  if (statusFilter) q = q.eq('status', statusFilter);
  if (fromDate)     q = q.gte('lr_date', fromDate);
  if (toDate)       q = q.lte('lr_date', toDate);
  if (searchQ)      q = q.or(`lr_number.ilike.%${searchQ}%,vehicle_no.ilike.%${searchQ}%`);

  const { data, error } = await q;
  if (error) { toast('Export failed: ' + error.message, 'err'); return; }
  exportCSV(data || [], `lr_register_${today()}.csv`);
}

// ── Finance Export Functions ─────────────────────────────────────
async function exportLedgerCSV() {
  if (!db) { toast('Not connected', 'err'); return; }
  toast('Fetching ledger data...', 'i');
  const { data, error } = await db.from('parties')
    .select('name,type,outstanding_balance,credit_limit')
    .eq('is_active', true).order('name');
  if (error) { toast('Export failed: ' + error.message, 'err'); return; }
  exportCSV(data || [], `party_ledger_${today()}.csv`);
}

async function exportPaymentsCSV() {
  if (!db) { toast('Not connected', 'err'); return; }
  toast('Fetching payments data...', 'i');
  const fromDate = getVal('pmt-filter-from');
  const toDate   = getVal('pmt-filter-to');
  const mode     = getVal('pmt-filter-mode');
  let q = db.from('payments')
    .select('payment_date,party:party_id(name),amount,payment_mode,reference_no,notes')
    .order('payment_date', { ascending: false });
  if (fromDate) q = q.gte('payment_date', fromDate);
  if (toDate)   q = q.lte('payment_date', toDate);
  if (mode)     q = q.eq('payment_mode', mode);
  const { data, error } = await q;
  if (error) { toast('Export failed: ' + error.message, 'err'); return; }
  const flat = (data || []).map(r => ({ ...r, party: r.party?.name || '' }));
  exportCSV(flat, `payments_${today()}.csv`);
}

async function exportExpensesCSV() {
  if (!db) { toast('Not connected', 'err'); return; }
  toast('Fetching expenses data...', 'i');
  const fromDate = getVal('exp-filter-from');
  const toDate   = getVal('exp-filter-to');
  const cat      = getVal('exp-filter-cat');
  let q = db.from('expenses')
    .select('expense_date,category,amount,reference_no,notes,branch:branch_id(name)')
    .order('expense_date', { ascending: false });
  if (fromDate) q = q.gte('expense_date', fromDate);
  if (toDate)   q = q.lte('expense_date', toDate);
  if (cat)      q = q.eq('category', cat);
  const { data, error } = await q;
  if (error) { toast('Export failed: ' + error.message, 'err'); return; }
  const flat = (data || []).map(r => ({ ...r, branch: r.branch?.name || '' }));
  exportCSV(flat, `expenses_${today()}.csv`);
}

async function exportDaybookCSV() {
  if (!db) { toast('Not connected', 'err'); return; }
  toast('Fetching daybook data...', 'i');
  const dateVal = getVal('daybook-date') || today();
  const [pmtRes, expRes] = await Promise.all([
    db.from('payments').select('payment_date,party:party_id(name),amount,payment_mode,reference_no').eq('payment_date', dateVal),
    db.from('expenses').select('expense_date,category,amount,reference_no,notes').eq('expense_date', dateVal),
  ]);
  const rows = [
    ...(pmtRes.data || []).map(r => ({ date: r.payment_date, type: 'Income', category: r.party?.name || '', amount: r.amount, ref: r.reference_no || '' })),
    ...(expRes.data || []).map(r => ({ date: r.expense_date, type: 'Expense', category: r.category || '', amount: r.amount, ref: r.reference_no || '' })),
  ];
  exportCSV(rows, `daybook_${dateVal}.csv`);
}

function updateBulkBar() {
  const checked = document.querySelectorAll('#lr-tbody-main .lr-sel:checked');
  const bulkBar = document.getElementById('lr-bulk-bar');
  if (bulkBar) bulkBar.style.display = checked.length > 0 ? '' : 'none';
}

async function applyBulkAction() {
  const action = getVal('lr-bulk-action');
  if (!action) { toast('Select a bulk action', 'warn'); return; }
  const ids = [...document.querySelectorAll('#lr-tbody-main .lr-sel:checked')].map(el => el.dataset.id);
  if (ids.length === 0) { toast('No LRs selected', 'warn'); return; }

  const ok = await confirmAction(`Apply "${slugToLabel(action)}" to ${ids.length} LR(s)?`);
  if (!ok) return;

  const { error } = await db.from('lorry_receipts').update({ status: action }).in('id', ids);
  if (error) { toast('Bulk action failed: ' + error.message, 'err'); return; }
  ids.forEach(id => auditLog('UPDATE', 'lr', id, action, { bulk: true }));
  toast(`${ids.length} LR(s) updated to ${slugToLabel(action)}`, 'ok');
  loadLRRegister();
}

async function openPrintModal(lrId) {
  if (!lrId) { toast('No LR selected for printing', 'warn'); return; }
  if (!db)   { toast('Database not connected', 'err'); return; }

  toast('Preparing LR print…', 'i');

  const { data: lr, error } = await db.from('lorry_receipts')
    .select('*, consignor:consignor_id(name,address,gstin), consignee:consignee_id(name,address,gstin), driver:driver_id(name), booking:booking_id(booking_no)')
    .eq('id', lrId).single();

  if (error || !lr) {
    toast('Failed to load LR: ' + (error?.message || 'not found'), 'err');
    return;
  }

  // Flatten booking_no
  if (lr.booking) lr.booking_no = lr.booking.booking_no;

  // Encode full payload into URL param — lr-print.html reads on DOMContentLoaded.
  // Zero race condition: data is in the URL before the page script even runs.
  const payload = { lr, settings: APP.settings || {} };
  const encoded = encodeURIComponent(JSON.stringify(payload));
  const url = 'lr-print.html?d=' + encoded;

  let printWin;

  if (url.length < 8000) {
    // Pass data via URL param (reliable, no timing issues)
    printWin = window.open(url, '_blank',
      'width=870,height=920,scrollbars=yes,toolbar=no,menubar=no,location=no,status=no');
  } else {
    // Fallback for very large payloads: set global on window object before scripts run
    printWin = window.open('lr-print.html', '_blank',
      'width=870,height=920,scrollbars=yes,toolbar=no,menubar=no,location=no,status=no');
    if (printWin) {
      try { printWin.LR_DATA = payload; } catch(e) {}
    }
  }

  if (!printWin) {
    toast('Pop-up blocked — please allow pop-ups for this site and try again', 'err');
  }
}

// ═══════════════════════════════════════════════════════════════
// 4. MANIFEST
// ═══════════════════════════════════════════════════════════════

async function loadManifest() {
  if (!db) return;
  showTableSkeleton('manifest-tbody', 9);
  const { page, pageSize } = APP.pagination.manifest;
  const from = (page - 1) * pageSize, to = from + pageSize - 1;

  const statusFilter = getVal('manifest-filter-status');
  const dateFilter   = getVal('manifest-filter-date');

  let q = db.from('manifests')
    .select('*, driver:driver_id(name), from_branch:from_branch_id(name), to_branch:to_branch_id(name), manifest_lrs(id)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (statusFilter) q = q.eq('status', statusFilter);
  if (dateFilter)   q = q.eq('manifest_date', dateFilter);

  const { data, count, error } = await q;
  APP.pagination.manifest.total = count || 0;

  const tbody = document.getElementById('manifest-tbody');
  if (error) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="9" class="empty"><div class="empty-txt">Failed to load manifests</div></td></tr>`;
    toast('Failed to load manifests: ' + error.message, 'err'); return;
  }

  if (!data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="empty"><div class="empty-ico">🚛</div><div class="empty-txt">No manifests found</div></td></tr>`;
  } else {
    tbody.innerHTML = data.map(m => {
      const lrCount = m.manifest_lrs?.length || 0;
      const actions = m.status === 'draft'
        ? `<button class="btn btn-pri btn-xs" onclick="dispatchManifest('${m.id}','${m.manifest_no}')">DISPATCH</button>
           <button class="btn btn-ghost btn-xs">EDIT</button>`
        : `<button class="btn btn-ghost btn-xs">VIEW</button>
           <button class="btn btn-ghost btn-xs">PRINT</button>`;
      return `<tr>
        <td class="td-id">${m.manifest_no}</td>
        <td class="td-muted">${formatDate(m.manifest_date)}</td>
        <td style="font-family:var(--font-mono);font-size:11px">${m.vehicle_no}</td>
        <td class="td-pri">${m.driver?.name || '—'}</td>
        <td>${m.from_branch?.name || '—'}</td>
        <td>${m.to_branch?.name || '—'}</td>
        <td class="c"><span class="tag tag-booked">${lrCount} LRs</span></td>
        <td><span class="tag tag-${statusTag(m.status)}">${slugToLabel(m.status)}</span></td>
        <td><div class="row gap14">${actions}</div></td>
      </tr>`;
    }).join('');
  }
  renderPagination('pag-manifest', 'manifest');
}

async function loadManifestLRs() {
  const fromBranch = document.querySelector('#manifestModal .sel-from-branch')?.value;
  if (!fromBranch || !db) return;

  const listEl = document.getElementById('manifest-lr-list');
  if (!listEl) return;
  listEl.innerHTML = '<div style="padding:12px;color:var(--text-muted);font-size:11px">Loading available LRs...</div>';

  const { data, error } = await db.from('lorry_receipts')
    .select('id, lr_number, consignor:consignor_id(name), consignee:consignee_id(name), weight_kg, from_city, to_city')
    .eq('status', 'booked').is('manifest_id', null).eq('branch_id', fromBranch).order('lr_date');

  if (error || !data || data.length === 0) {
    listEl.innerHTML = '<div style="padding:12px;color:var(--text-muted);font-size:11.5px;text-align:center">No unmanifested LRs available for this branch</div>';
    return;
  }

  listEl.innerHTML = `<table class="itbl"><thead><tr><th><input type="checkbox" id="mf-sel-all" onchange="document.querySelectorAll('.lr-sel').forEach(c=>c.checked=this.checked)"></th><th>LR NUMBER</th><th>CONSIGNOR</th><th>CONSIGNEE</th><th>WEIGHT</th><th>ROUTE</th></tr></thead><tbody>` +
    data.map(lr => `<tr>
      <td><input type="checkbox" class="lr-sel" data-id="${lr.id}"></td>
      <td class="td-id">${lr.lr_number}</td>
      <td class="td-pri">${lr.consignor?.name || '—'}</td>
      <td>${lr.consignee?.name || '—'}</td>
      <td style="font-family:var(--font-mono)">${lr.weight_kg} kg</td>
      <td class="td-muted">${lr.from_city}→${lr.to_city}</td>
    </tr>`).join('') + '</tbody></table>';
}

async function saveManifest() {
  const vehicleNo   = getVal('mf-vehicle');
  const driverId    = document.querySelector('#manifestModal .sel-driver')?.value;
  const fromBranch  = document.querySelector('#manifestModal .sel-from-branch')?.value;
  const toBranch    = document.querySelector('#manifestModal .sel-to-branch')?.value;
  const manifestDate= getVal('mf-date') || today();

  if (!vehicleNo)  { toast('Vehicle number is required', 'err'); return; }
  if (!driverId)   { toast('Driver is required', 'err'); return; }
  if (!fromBranch) { toast('From branch is required', 'err'); return; }
  if (!toBranch)   { toast('To branch is required', 'err'); return; }

  const selectedLRs = [...document.querySelectorAll('#manifest-lr-list .lr-sel:checked')].map(el => el.dataset.id);
  if (selectedLRs.length === 0) { toast('Select at least one LR for the manifest', 'err'); return; }

  const btn = document.querySelector('#manifestModal .btn-pri[onclick="saveManifest()"]');
  setBtnLoading(btn, true, 'SAVING...');

  try {
    const manifest_no = await getNextNumber('manifest');
    const { data: mf, error } = await db.from('manifests').insert({
      manifest_no, manifest_date: manifestDate, vehicle_no: vehicleNo.toUpperCase(),
      driver_id: driverId, from_branch_id: fromBranch, to_branch_id: toBranch,
      status: 'draft', created_by: APP.user.id
    }).select().single();
    if (error) throw error;

    // Insert manifest_lrs
    await db.from('manifest_lrs').insert(selectedLRs.map(lrId => ({ manifest_id: mf.id, lr_id: lrId })));

    // Link LRs to manifest
    await db.from('lorry_receipts').update({ manifest_id: mf.id }).in('id', selectedLRs);

    auditLog('CREATE', 'manifest', mf.id, manifest_no, { lr_count: selectedLRs.length });
    toast('Manifest ' + manifest_no + ' created with ' + selectedLRs.length + ' LR(s)', 'ok');
    C('manifestModal');
    loadManifest();
  } catch(e) {
    toast('Failed to save manifest: ' + e.message, 'err');
  } finally {
    setBtnLoading(btn, false);
  }
}

async function dispatchManifest(id, manifestNo) {
  const ok = await confirmAction(`Dispatch manifest ${manifestNo}? All linked LRs will be set to IN TRANSIT. This cannot be undone.`);
  if (!ok) return;

  try {
    await db.from('manifests').update({ status: 'dispatched', dispatch_time: new Date().toISOString() }).eq('id', id);

    const { data: links } = await db.from('manifest_lrs').select('lr_id').eq('manifest_id', id);
    if (links && links.length > 0) {
      const lrIds = links.map(l => l.lr_id);
      await db.from('lorry_receipts').update({ status: 'in_transit' }).in('id', lrIds);
    }

    auditLog('DISPATCH', 'manifest', id, manifestNo);
    toast('Manifest dispatched — LRs set to IN TRANSIT', 'ok');
    loadManifest();
    loadDashboard();
  } catch(e) {
    toast('Dispatch failed: ' + e.message, 'err');
  }
}

// ═══════════════════════════════════════════════════════════════
// 5. DISPATCH PAGE
// ═══════════════════════════════════════════════════════════════

async function loadDispatch() {
  if (!db) return;
  const { data, error } = await db.from('manifests')
    .select('*, driver:driver_id(name), from_branch:from_branch_id(name), to_branch:to_branch_id(name), manifest_lrs(id)')
    .eq('status', 'draft').order('created_at', { ascending: false });

  const tbody = document.getElementById('dispatch-tbody');
  if (!tbody) return;

  if (error || !data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty"><div class="empty-ico">✅</div><div class="empty-txt">No manifests pending dispatch</div><div class="empty-sub">All manifests have been dispatched</div></td></tr>`;
    return;
  }

  tbody.innerHTML = data.map(m => {
    const lrCount = m.manifest_lrs?.length || 0;
    return `<tr>
      <td class="td-id">${m.manifest_no}</td>
      <td style="font-family:var(--font-mono);font-size:11px">${m.vehicle_no}</td>
      <td class="td-pri">${m.driver?.name || '—'}</td>
      <td><span class="tag tag-booked">${lrCount} LRs</span></td>
      <td class="td-num">—</td>
      <td class="td-muted">${m.from_branch?.name || '—'} → ${m.to_branch?.name || '—'}</td>
      <td><span class="tag tag-draft">Ready</span></td>
      <td><button class="btn btn-pri btn-sm" onclick="dispatchManifest('${m.id}','${m.manifest_no}')">DISPATCH & LOCK</button></td>
    </tr>`;
  }).join('');
}

// ═══════════════════════════════════════════════════════════════
// 6. DELIVERY
// ═══════════════════════════════════════════════════════════════

async function loadDelivery() {
  if (!db) return;
  showTableSkeleton('delivery-tbody', 10);
  const { page, pageSize } = APP.pagination.delivery;
  const from = (page - 1) * pageSize, to = from + pageSize - 1;

  const searchQ   = getVal('delivery-filter-search');
  const branchFilter = getVal('delivery-filter-branch');

  let q = db.from('lorry_receipts')
    .select('id, lr_number, consignee:consignee_id(name,id), to_city, vehicle_no, lr_date, status, payment_type, total_amount', { count: 'exact' })
    .in('status', ['in_transit','partial'])
    .order('lr_date', { ascending: true })
    .range(from, to);

  if (searchQ)     q = q.or(`lr_number.ilike.%${searchQ}%`);
  if (branchFilter) q = q.eq('branch_id', branchFilter);

  const { data, count, error } = await q;
  APP.pagination.delivery.total = count || 0;

  const tbody = document.getElementById('delivery-tbody');
  setHTML('delivery-subtitle', `PENDING DELIVERIES · ${num(count || 0)} LRs`);

  if (error || !data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" class="empty"><div class="empty-ico">✅</div><div class="empty-txt">No pending deliveries</div></td></tr>`;
  } else {
    const todayDate = new Date(today());
    tbody.innerHTML = data.map(lr => {
      const daysInTransit = Math.ceil((todayDate - new Date(lr.lr_date)) / 86400000);
      return `<tr>
        <td class="td-id">${lr.lr_number}</td>
        <td class="td-pri">${lr.consignee?.name || '—'}</td>
        <td>${lr.to_city}</td>
        <td class="c">—</td>
        <td class="c" style="color:#4ade80;font-family:var(--font-mono)">0</td>
        <td class="c" style="color:#fbbf24;font-family:var(--font-mono)">—</td>
        <td class="c" style="color:#f87171;font-family:var(--font-mono)">0</td>
        <td class="c" style="color:#f87171;font-family:var(--font-mono)">0</td>
        <td><span class="tag tag-${statusTag(lr.status)}">${slugToLabel(lr.status)}</span></td>
        <td><button class="btn btn-success btn-sm" onclick="openDeliveryModal('${lr.id}')">MARK DELIVERY</button></td>
      </tr>`;
    }).join('');
  }
  renderPagination('pag-delivery', 'delivery');
}

async function openDeliveryModal(lrId) {
  if (!db) return;
  const { data: lr } = await db.from('lorry_receipts')
    .select('*, consignee:consignee_id(name,id)')
    .eq('id', lrId).single();
  if (!lr) return;

  _deliveryLRId = lrId;
  _deliveryLR   = lr;

  const subEl = document.querySelector('#deliveryModal .mhd-sub');
  if (subEl) subEl.textContent = lr.lr_number + ' · ' + (lr.consignee?.name || '—') + ' · ' + lr.to_city;

  setVal('delivery-date',    today());
  setVal('delivery-status',  'delivered');
  setVal('delivery-remarks', '');
  M('deliveryModal');
}

async function saveDelivery() {
  if (!_deliveryLRId || !db) return;
  const status  = getVal('delivery-status') || 'delivered';
  const delDate = getVal('delivery-date') || today();
  const remarks = getVal('delivery-remarks');
  const btn     = document.querySelector('#deliveryModal .btn-pri[onclick="saveDelivery()"]');

  setBtnLoading(btn, true, 'SAVING...');
  try {
    const { error } = await db.from('lorry_receipts').update({
      status, delivery_date: delDate, pod_remarks: remarks
    }).eq('id', _deliveryLRId);
    if (error) throw error;

    auditLog('UPDATE', 'delivery', _deliveryLRId, _deliveryLR?.lr_number, { status, delivery_date: delDate });
    toast('Delivery saved — LR status: ' + slugToLabel(status), 'ok');
    C('deliveryModal');
    loadDelivery();

    // Auto-open payment modal for to_pay LRs
    if (_deliveryLR?.payment_type === 'to_pay') {
      setTimeout(() => {
        const partyEl = document.querySelector('#paymentModal .sel-party');
        if (partyEl && _deliveryLR.consignee_id) partyEl.value = _deliveryLR.consignee_id;
        setVal('pmt-amount',  _deliveryLR.total_amount);
        setVal('pmt-date',    today());
        M('paymentModal');
      }, 400);
    }
  } catch(e) {
    toast('Failed to save delivery: ' + e.message, 'err');
  } finally {
    setBtnLoading(btn, false);
  }
}

// ═══════════════════════════════════════════════════════════════
// 7. PARTY LEDGER
// ═══════════════════════════════════════════════════════════════

function populateLedgerDropdown() {
  const selEl = document.getElementById('ledgerPartySelect');
  if (!selEl) return;
  selEl.innerHTML = '<option value="">— Select Party —</option>' +
    APP.cache.parties.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  selEl.onchange = () => { if (selEl.value) loadLedger(selEl.value); };

  // Also populate outstanding summary
  loadOutstandingSummary();
}

async function loadOutstandingSummary() {
  if (!db) return;
  const { data } = await db.from('parties').select('id,name,type,outstanding_balance,credit_limit')
    .gt('outstanding_balance', 0).order('outstanding_balance', { ascending: false }).limit(20);

  const tbody = document.getElementById('ledger-summary-tbody');
  if (!tbody) return;

  if (!data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty"><div class="empty-txt">No outstanding balances</div></td></tr>`;
    return;
  }

  let totalOutstanding = 0;
  tbody.innerHTML = data.map(p => {
    totalOutstanding += parseFloat(p.outstanding_balance || 0);
    const limitPct = p.credit_limit > 0 ? Math.min(100, Math.round(p.outstanding_balance / p.credit_limit * 100)) : 0;
    const barColor = limitPct >= 100 ? 'var(--red)' : limitPct >= 90 ? 'var(--amber)' : 'var(--green)';
    return `<tr>
      <td class="td-pri td-id" onclick="selectLedgerParty('${p.id}')">${p.name}</td>
      <td><span class="tag tag-${p.type === 'consignor' ? 'topay' : p.type === 'consignee' ? 'booked' : 'credit'}">${capitalize(p.type)}</span></td>
      <td class="r dr">₹${num(p.outstanding_balance)}</td>
      <td class="r cr">—</td>
      <td class="r bal-dr td-num">₹${num(p.outstanding_balance)} Dr</td>
      <td>${p.credit_limit > 0 ? `<div style="background:var(--navy-700);border-radius:1px;height:4px;width:100px;overflow:hidden"><div style="background:${barColor};height:100%;width:${limitPct}%"></div></div>` : '—'}</td>
    </tr>`;
  }).join('');

  setHTML('ledger-total-outstanding', '₹' + num(totalOutstanding));
}

function selectLedgerParty(partyId) {
  const selEl = document.getElementById('ledgerPartySelect');
  if (selEl) selEl.value = partyId;
  loadLedger(partyId);
}

async function loadLedger(partyId) {
  if (!db || !partyId) return;
  const detailTbody = document.getElementById('ledgerDetail');
  if (detailTbody) detailTbody.innerHTML = '<tr><td colspan="5" style="padding:12px;text-align:center;color:var(--text-muted)">Loading...</td></tr>';

  const [ledgerRes, partyRes] = await Promise.all([
    db.from('party_ledger').select('*').eq('party_id', partyId).order('txn_date'),
    db.from('parties').select('name,outstanding_balance,credit_limit').eq('id', partyId).single()
  ]);

  if (ledgerRes.error) { toast('Failed to load ledger', 'err'); return; }

  const entries = ledgerRes.data || [];
  let runningBalance = 0;

  if (!detailTbody) return;
  if (entries.length === 0) {
    detailTbody.innerHTML = `<tr><td colspan="5" class="empty"><div class="empty-txt">No transactions found</div></td></tr>`;
    return;
  }

  detailTbody.innerHTML = entries.map(e => {
    runningBalance += parseFloat(e.debit_amount || 0) - parseFloat(e.credit_amount || 0);
    const balClass = runningBalance > 0 ? 'bal-dr' : runningBalance < 0 ? 'bal-cr' : '';
    const balLabel = runningBalance > 0 ? 'Dr' : runningBalance < 0 ? 'Cr' : '';
    return `<tr>
      <td class="td-muted">${formatDate(e.txn_date)}</td>
      <td class="td-id">${e.ref_no}</td>
      <td>${e.txn_type}</td>
      <td class="r ${e.debit_amount > 0 ? 'dr' : 'td-muted'}">${e.debit_amount > 0 ? '₹'+num(e.debit_amount) : '—'}</td>
      <td class="r ${e.credit_amount > 0 ? 'cr' : 'td-muted'}">${e.credit_amount > 0 ? '₹'+num(e.credit_amount) : '—'}</td>
      <td class="r ${balClass} td-num">₹${num(Math.abs(runningBalance))} ${balLabel}</td>
    </tr>`;
  }).join('');

  if (partyRes.data) {
    const p = partyRes.data;
    const hdr = document.querySelector('#pg-ledger .ph-sub');
    if (hdr) hdr.textContent = `OUTSTANDING · ₹${num(p.outstanding_balance)}`;
  }
}

// ═══════════════════════════════════════════════════════════════
// 8. PAYMENTS
// ═══════════════════════════════════════════════════════════════

async function loadPayments() {
  if (!db) return;
  showTableSkeleton('payments-tbody', 8);
  const { page, pageSize } = APP.pagination.payments;
  const from = (page - 1) * pageSize, to = from + pageSize - 1;

  const partyFilter = getVal('pmt-filter-party');
  const fromDate    = getVal('pmt-filter-from');
  const toDate      = getVal('pmt-filter-to');
  const modeFilter  = getVal('pmt-filter-mode');

  let q = db.from('payments')
    .select('*, party:party_id(name)', { count: 'exact' })
    .order('payment_date', { ascending: false })
    .range(from, to);

  if (partyFilter) q = q.eq('party_id', partyFilter);
  if (fromDate)    q = q.gte('payment_date', fromDate);
  if (toDate)      q = q.lte('payment_date', toDate);
  if (modeFilter)  q = q.eq('payment_mode', modeFilter);

  const { data, count, error } = await q;
  APP.pagination.payments.total = count || 0;

  const tbody = document.getElementById('payments-tbody');
  if (error) { if (tbody) tbody.innerHTML = `<tr><td colspan="8"><div class="empty-txt">Failed to load payments</div></td></tr>`; return; }

  if (!data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty"><div class="empty-ico">💳</div><div class="empty-txt">No payments found</div></td></tr>`;
  } else {
    tbody.innerHTML = data.map(p => `<tr>
      <td class="td-muted">${formatDate(p.payment_date)}</td>
      <td class="td-pri">${p.party?.name || '—'}</td>
      <td class="r td-num" style="color:#4ade80">₹${num(p.amount)}</td>
      <td><span class="tag tag-booked">${p.payment_mode.toUpperCase()}</span></td>
      <td style="font-family:var(--font-mono);font-size:11px">${p.reference_no || '—'}</td>
      <td>—</td>
      <td class="td-muted">—</td>
      <td><button class="btn btn-ghost btn-xs">VIEW</button></td>
    </tr>`).join('');
  }
  renderPagination('pag-payments', 'payments');
}

async function savePayment() {
  const partyEl = document.querySelector('#paymentModal .sel-party');
  const partyId = partyEl?.value;
  const amount  = parseFloat(getVal('pmt-amount'));
  const pDate   = getVal('pmt-date') || today();
  const mode    = getVal('pmt-mode') || 'cash';
  const ref     = getVal('pmt-ref');
  const remarks = getVal('pmt-remarks');
  const branchEl= document.querySelector('#paymentModal .sel-branch');
  const branchId= branchEl?.value || APP.branch.id;

  if (!partyId)    { toast('Party is required', 'err'); return; }
  if (!amount || amount <= 0) { toast('Amount must be greater than 0', 'err'); return; }
  if (!pDate)      { toast('Date is required', 'err'); return; }
  if (!mode)       { toast('Payment mode is required', 'err'); return; }

  const btn = document.querySelector('#paymentModal .btn-pri[onclick="savePayment()"]');
  setBtnLoading(btn, true, 'SAVING...');
  try {
    const payment_ref = await getNextNumber('payment');
    const { data, error } = await db.from('payments').insert({
      payment_ref, party_id: partyId, payment_date: pDate,
      amount, payment_mode: mode, reference_no: ref, remarks, branch_id: branchId,
      created_by: APP.user.id
    }).select().single();
    if (error) throw error;

    // Reduce party outstanding
    const party = APP.cache.parties.find(p => p.id === partyId);
    if (party) {
      const newBal = Math.max(0, (parseFloat(party.outstanding_balance) || 0) - amount);
      await db.from('parties').update({ outstanding_balance: newBal }).eq('id', partyId);
      party.outstanding_balance = newBal;
    }

    auditLog('CREATE', 'payment', data.id, payment_ref);
    toast('Payment ' + payment_ref + ' recorded', 'ok');
    C('paymentModal');
    loadPayments();
  } catch(e) {
    toast('Failed to save payment: ' + e.message, 'err');
  } finally {
    setBtnLoading(btn, false);
  }
}

// ═══════════════════════════════════════════════════════════════
// 9. DAYBOOK
// ═══════════════════════════════════════════════════════════════

async function loadDaybook(date) {
  if (!db) return;
  const targetDate = date || today();
  setVal('daybook-date', targetDate);

  const { data, error } = await db.from('daybook').select('*').eq('entry_date', targetDate);
  if (error) { toast('Failed to load daybook', 'err'); return; }

  const entries = data || [];
  const totalCredit = entries.reduce((s, e) => s + parseFloat(e.credit_amount || 0), 0);
  const totalDebit  = entries.reduce((s, e) => s + parseFloat(e.debit_amount || 0), 0);
  const net         = totalCredit - totalDebit;

  setHTML('daybook-kpi-income',  '₹' + num(totalCredit));
  setHTML('daybook-kpi-expense', '₹' + num(totalDebit));
  setHTML('daybook-kpi-net',     '₹' + num(net));

  const tbody = document.getElementById('daybook-tbody');
  if (!tbody) return;
  if (entries.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty"><div class="empty-ico">📖</div><div class="empty-txt">No entries for ${formatDate(targetDate)}</div></td></tr>`;
    return;
  }

  tbody.innerHTML = entries.map(e => `<tr>
    <td class="td-muted">${formatDate(e.entry_date)}</td>
    <td><span class="tag tag-${e.entry_type === 'Payment' ? 'delivered' : 'cancelled'}">${e.entry_type.toUpperCase()}</span></td>
    <td>${e.ref_no || '—'}</td>
    <td class="r td-num" style="color:${e.credit_amount > 0 ? '#4ade80' : '#f87171'}">₹${num(e.credit_amount > 0 ? e.credit_amount : e.debit_amount)}</td>
    <td class="td-muted">${e.remarks || '—'}</td>
    <td class="td-muted">—</td>
  </tr>`).join('');
}

// ═══════════════════════════════════════════════════════════════
// 10. EXPENSES
// ═══════════════════════════════════════════════════════════════

async function loadExpenses() {
  if (!db) return;
  showTableSkeleton('expenses-tbody', 6);
  const { page, pageSize } = APP.pagination.expenses;
  const from = (page - 1) * pageSize, to = from + pageSize - 1;

  const fromDate  = getVal('exp-filter-from');
  const toDate    = getVal('exp-filter-to');
  const catFilter = getVal('exp-filter-cat');

  let q = db.from('expenses')
    .select('*', { count: 'exact' })
    .order('expense_date', { ascending: false })
    .range(from, to);

  if (fromDate)  q = q.gte('expense_date', fromDate);
  if (toDate)    q = q.lte('expense_date', toDate);
  if (catFilter) q = q.eq('category', catFilter);

  const { data, count, error } = await q;
  APP.pagination.expenses.total = count || 0;

  const tbody = document.getElementById('expenses-tbody');
  if (error) { if (tbody) tbody.innerHTML = `<tr><td colspan="6"><div class="empty-txt">Failed to load expenses</div></td></tr>`; return; }

  if (!data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty"><div class="empty-ico">💸</div><div class="empty-txt">No expenses found</div></td></tr>`;
  } else {
    tbody.innerHTML = data.map(e => `<tr>
      <td class="td-muted">${formatDate(e.expense_date)}</td>
      <td class="td-id">${e.expense_ref}</td>
      <td>${e.category}</td>
      <td class="r td-num" style="color:#f87171">₹${num(e.amount)}</td>
      <td class="td-muted">${e.description || '—'}</td>
      <td class="td-muted">—</td>
    </tr>`).join('');
  }
  renderPagination('pag-expenses', 'expenses');
}

async function saveExpense() {
  const category   = getVal('exp-category');
  const amount     = parseFloat(getVal('exp-amount'));
  const expDate    = getVal('exp-date') || today();
  const lrRef      = getVal('exp-lr-ref');
  const desc       = getVal('exp-desc');
  const modeEl     = document.querySelector('#expenseModal select[id="exp-mode"]');
  const mode       = modeEl?.value || 'cash';

  if (!category)         { toast('Expense type is required', 'err'); return; }
  if (!amount || amount <= 0) { toast('Amount must be greater than 0', 'err'); return; }
  if (!expDate)          { toast('Date is required', 'err'); return; }

  const btn = document.querySelector('#expenseModal .btn-pri[onclick="saveExpense()"]');
  setBtnLoading(btn, true, 'SAVING...');
  try {
    const expense_ref = await getNextNumber('expense');
    let lrId = null;
    if (lrRef) {
      const { data: lrRow } = await db.from('lorry_receipts').select('id').ilike('lr_number', lrRef).single();
      if (lrRow) lrId = lrRow.id;
    }
    const { data, error } = await db.from('expenses').insert({
      expense_ref, expense_date: expDate, lr_id: lrId,
      category, amount, payment_mode: mode, description: desc,
      branch_id: APP.branch.id, created_by: APP.user.id
    }).select().single();
    if (error) throw error;
    auditLog('CREATE', 'expense', data.id, category + ' — ' + amount);
    toast('Expense saved: ' + expense_ref, 'ok');
    C('expenseModal');
    loadExpenses();
  } catch(e) {
    toast('Failed to save expense: ' + e.message, 'err');
  } finally {
    setBtnLoading(btn, false);
  }
}

// ═══════════════════════════════════════════════════════════════
// 11. E-WAY BILLS
// ═══════════════════════════════════════════════════════════════

async function loadEway() {
  if (!db) return;
  showTableSkeleton('eway-tbody', 9);
  if (ewayCountdownInterval) { clearInterval(ewayCountdownInterval); ewayCountdownInterval = null; }

  const { page, pageSize } = APP.pagination.eway;
  const from = (page - 1) * pageSize, to = from + pageSize - 1;
  const statusFilter = getVal('eway-filter-status');

  let q = db.from('lorry_receipts')
    .select('id, lr_number, vehicle_no, from_city, to_city, eway_bill_no, eway_expiry_date, consignor:consignor_id(name)', { count: 'exact' })
    .not('eway_bill_no', 'is', null).neq('eway_bill_no', '')
    .neq('status', 'cancelled')
    .order('eway_expiry_date', { ascending: true })
    .range(from, to);

  const { data, count, error } = await q;
  APP.pagination.eway.total = count || 0;

  // No-eway count
  const { count: noEwayCount } = await db.from('lorry_receipts')
    .select('id', { count: 'exact', head: true })
    .or('eway_bill_no.is.null,eway_bill_no.eq.')
    .neq('status', 'cancelled');

  // Compute stats
  const todayDate = new Date(today());
  const in24h = new Date(todayDate.getTime() + 86400000);
  let validCnt = 0, expiringCnt = 0, expiredCnt = 0;
  (data || []).forEach(r => {
    if (!r.eway_expiry_date) return;
    const exp = new Date(r.eway_expiry_date);
    if (exp < todayDate) expiredCnt++;
    else if (exp <= in24h) expiringCnt++;
    else validCnt++;
  });

  setHTML('eway-stat-valid',    validCnt);
  setHTML('eway-stat-expiring', expiringCnt);
  setHTML('eway-stat-expired',  expiredCnt);
  setHTML('eway-stat-noeway',   noEwayCount || 0);

  const tbody = document.getElementById('eway-tbody');
  if (error || !data || data.length === 0) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="9" class="empty"><div class="empty-ico">⬡</div><div class="empty-txt">No E-Way bills found</div></td></tr>`;
    return;
  }

  let filteredData = data;
  if (statusFilter) {
    filteredData = data.filter(r => {
      if (!r.eway_expiry_date) return false;
      const s = _ewayStatusClass(r.eway_expiry_date);
      return s === statusFilter;
    });
  }

  tbody.innerHTML = filteredData.map(lr => {
    const expDate = lr.eway_expiry_date;
    const stClass = _ewayStatusClass(expDate);
    const stLabel = _ewayStatusLabel(expDate);
    const diff    = expDate ? new Date(expDate) - new Date() : 0;
    const isExpiring = stClass === 'expiring';
    const expiryStyle = stClass === 'expired' ? 'color:#f87171' : stClass === 'expiring' ? 'color:#fbbf24' : 'color:#4ade80';

    return `<tr>
      <td class="td-id">${lr.lr_number}</td>
      <td style="font-family:var(--font-mono);font-size:11px">${lr.eway_bill_no}</td>
      <td class="td-muted">—</td>
      <td style="${expiryStyle};font-family:var(--font-mono);font-size:11px;font-weight:600">${formatDate(expDate)}</td>
      <td style="${expiryStyle};font-family:var(--font-mono);font-weight:700">${isExpiring ? `<span class="eway-countdown" data-expiry="${expDate}">calc</span>` : stClass === 'expired' ? Math.floor(diff/86400000) : Math.ceil(diff/86400000)}</td>
      <td><span class="tag tag-${stClass}">${stLabel}</span></td>
      <td style="font-family:var(--font-mono);font-size:11px">${lr.vehicle_no}</td>
      <td class="td-muted">${lr.from_city}→${lr.to_city}</td>
      <td><button class="btn btn-${stClass === 'expired' ? 'danger' : 'ghost'} btn-xs">RENEW</button></td>
    </tr>`;
  }).join('');

  // Start countdown update
  _updateEwayCountdowns();
  ewayCountdownInterval = setInterval(_updateEwayCountdowns, 60000);

  renderPagination('pag-eway', 'eway');
}

function _updateEwayCountdowns() {
  document.querySelectorAll('.eway-countdown').forEach(el => {
    const expiry = el.dataset.expiry;
    if (!expiry) return;
    const diff = new Date(expiry) - new Date();
    if (diff <= 0) { el.textContent = 'EXPIRED'; return; }
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    el.textContent = `${h}h ${m}m`;
  });
}

// ═══════════════════════════════════════════════════════════════
// 12. REPORTS
// ═══════════════════════════════════════════════════════════════

async function loadReport() {
  if (!db) return;
  showTableSkeleton('report-tbody', 12);

  const reportType  = getVal('reportType') || 'lr';
  const fromDate    = getVal('report-from');
  const toDate      = getVal('report-to');
  const branchFilter= getVal('report-branch');

  const { page, pageSize } = APP.pagination.reports;
  const from = (page - 1) * pageSize, to = from + pageSize - 1;

  let data = [], count = 0, columns = [], totals = {};

  try {
    switch(reportType) {
      case 'lr': {
        let q = db.from('lorry_receipts')
          .select('lr_number,lr_date,consignor:consignor_id(name),consignee:consignee_id(name),vehicle_no,payment_type,freight_amount,gst_amount,total_amount,status', { count: 'exact' })
          .order('lr_date', { ascending: false }).range(from, to);
        if (fromDate) q = q.gte('lr_date', fromDate);
        if (toDate)   q = q.lte('lr_date', toDate);
        if (branchFilter) q = q.eq('branch_id', branchFilter);
        const res = await q;
        data = res.data || []; count = res.count || 0;
        columns = ['LR NUMBER','DATE','CONSIGNOR','CONSIGNEE','VEHICLE','PAYMENT','FREIGHT','GST','TOTAL','STATUS'];
        const tFreight = data.reduce((s,r) => s + parseFloat(r.freight_amount||0), 0);
        const tGst     = data.reduce((s,r) => s + parseFloat(r.gst_amount||0), 0);
        const tAmt     = data.reduce((s,r) => s + parseFloat(r.total_amount||0), 0);
        totals = { Records: num(count), 'Total Freight': '₹'+num(tFreight), 'Total GST': '₹'+num(tGst), 'Grand Total': '₹'+num(tAmt) };
        const tbody = document.getElementById('report-tbody');
        if (tbody) tbody.innerHTML = data.map(r => `<tr>
          <td class="td-id">${r.lr_number}</td><td class="td-muted">${formatDate(r.lr_date)}</td>
          <td class="td-pri">${r.consignor?.name||'—'}</td><td>${r.consignee?.name||'—'}</td>
          <td style="font-family:var(--font-mono);font-size:11px">${r.vehicle_no}</td>
          <td><span class="tag tag-${paymentTag(r.payment_type)}">${slugToLabel(r.payment_type)}</span></td>
          <td class="r td-num">₹${num(r.freight_amount)}</td><td class="r td-num">₹${num(r.gst_amount)}</td>
          <td class="r td-num">₹${num(r.total_amount)}</td>
          <td><span class="tag tag-${statusTag(r.status)}">${slugToLabel(r.status)}</span></td>
        </tr>`).join('') || '<tr><td colspan="10" class="empty"><div class="empty-txt">No records</div></td></tr>';
        break;
      }
      case 'outstanding': {
        let q = db.from('parties').select('name,type,outstanding_balance,credit_limit', { count: 'exact' })
          .gt('outstanding_balance', 0).order('outstanding_balance', { ascending: false }).range(from, to);
        const res = await q; data = res.data || []; count = res.count || 0;
        const tOut = data.reduce((s,r) => s + parseFloat(r.outstanding_balance||0), 0);
        totals = { Parties: num(count), 'Total Outstanding': '₹'+num(tOut) };
        const tbody = document.getElementById('report-tbody');
        if (tbody) tbody.innerHTML = data.map(r => `<tr>
          <td class="td-pri">${r.name}</td>
          <td><span class="tag tag-${r.type==='consignor'?'topay':r.type==='consignee'?'booked':'credit'}">${capitalize(r.type)}</span></td>
          <td class="r dr">₹${num(r.outstanding_balance)}</td>
          <td class="r td-muted">${r.credit_limit > 0 ? '₹'+num(r.credit_limit) : '—'}</td>
        </tr>`).join('') || '<tr><td colspan="4" class="empty"><div class="empty-txt">No outstanding balances</div></td></tr>';
        break;
      }
      case 'cashbook':
      case 'daybook': {
        let q = db.from('daybook').select('*', { count: 'exact' }).order('entry_date', { ascending: false }).range(from, to);
        if (fromDate) q = q.gte('entry_date', fromDate);
        if (toDate)   q = q.lte('entry_date', toDate);
        const res = await q; data = res.data || []; count = res.count || 0;
        const tIn  = data.reduce((s,r) => s + parseFloat(r.credit_amount||0), 0);
        const tOut = data.reduce((s,r) => s + parseFloat(r.debit_amount||0), 0);
        totals = { Records: num(count), 'Cash In': '₹'+num(tIn), 'Cash Out': '₹'+num(tOut), Net: '₹'+num(tIn-tOut) };
        const tbody = document.getElementById('report-tbody');
        if (tbody) tbody.innerHTML = data.map(r => `<tr>
          <td class="td-muted">${formatDate(r.entry_date)}</td>
          <td><span class="tag tag-${r.entry_type==='Payment'?'delivered':'cancelled'}">${r.entry_type}</span></td>
          <td>${r.ref_no||'—'}</td><td class="td-pri">${r.party_name||'—'}</td>
          <td class="r td-num" style="color:#4ade80">${r.credit_amount>0?'₹'+num(r.credit_amount):'—'}</td>
          <td class="r td-num" style="color:#f87171">${r.debit_amount>0?'₹'+num(r.debit_amount):'—'}</td>
          <td class="td-muted">${r.remarks||'—'}</td>
        </tr>`).join('') || '<tr><td colspan="7" class="empty"><div class="empty-txt">No entries</div></td></tr>';
        break;
      }
      case 'expense': {
        let q = db.from('expenses').select('expense_ref,expense_date,category,amount,description', { count: 'exact' })
          .order('expense_date', { ascending: false }).range(from, to);
        if (fromDate) q = q.gte('expense_date', fromDate);
        if (toDate)   q = q.lte('expense_date', toDate);
        const res = await q; data = res.data || []; count = res.count || 0;
        const tAmt = data.reduce((s,r) => s + parseFloat(r.amount||0), 0);
        totals = { Records: num(count), 'Total Expenses': '₹'+num(tAmt) };
        const tbody = document.getElementById('report-tbody');
        if (tbody) tbody.innerHTML = data.map(r => `<tr>
          <td class="td-muted">${formatDate(r.expense_date)}</td>
          <td class="td-id">${r.expense_ref}</td>
          <td>${r.category}</td>
          <td class="r td-num" style="color:#f87171">₹${num(r.amount)}</td>
          <td class="td-muted">${r.description||'—'}</td>
        </tr>`).join('') || '<tr><td colspan="5" class="empty"><div class="empty-txt">No expenses</div></td></tr>';
        break;
      }
      default: {
        const tbody = document.getElementById('report-tbody');
        if (tbody) tbody.innerHTML = '<tr><td colspan="12" class="empty"><div class="empty-txt">Select a report type and click GENERATE</div></td></tr>';
      }
    }
  } catch(e) {
    toast('Report failed: ' + e.message, 'err');
  }

  // Totals bar
  APP.pagination.reports.total = count;
  const rtotalEl = document.getElementById('report-rtotal');
  if (rtotalEl && Object.keys(totals).length > 0) {
    rtotalEl.innerHTML = Object.entries(totals).map(([k,v]) => `
      <div class="rtt"><div class="rtt-lbl">${k}</div><div class="rtt-val">${v}</div></div>
    `).join('');
    rtotalEl.style.display = '';
  }
  renderPagination('pag-reports', 'reports');
}

async function exportReportCSV() {
  if (!db) return;
  const reportType = getVal('reportType') || 'lr';
  const fromDate   = getVal('report-from');
  const toDate     = getVal('report-to');

  let q;
  if (reportType === 'lr') {
    q = db.from('lorry_receipts').select('lr_number,lr_date,vehicle_no,from_city,to_city,payment_type,freight_amount,total_amount,status').order('lr_date', { ascending: false });
    if (fromDate) q = q.gte('lr_date', fromDate);
    if (toDate)   q = q.lte('lr_date', toDate);
  } else if (reportType === 'outstanding') {
    q = db.from('parties').select('name,type,outstanding_balance,credit_limit').gt('outstanding_balance', 0).order('outstanding_balance', { ascending: false });
  } else {
    toast('Export not available for this report type', 'warn'); return;
  }
  toast('Preparing export...', 'i');
  const { data } = await q;
  exportCSV(data || [], `${reportType}_report_${today()}.csv`);
}
