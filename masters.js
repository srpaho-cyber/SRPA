// ═══════════════════════════════════════════════════════════════
// FREIGHT ERP PRO — masters.js
// Admin modules: Settings, Branches, Parties, Drivers, Vehicles,
// Brokers, Rates, Number Series, Users, Audit Log, Backup/Restore
// ═══════════════════════════════════════════════════════════════

// Register page loaders
PAGE_LOADERS['users']    = () => loadUsers();
PAGE_LOADERS['auditlog'] = () => loadAuditLog();
PAGE_LOADERS['masters']  = () => loadMastersBranches();
PAGE_LOADERS['settings'] = () => loadSettings();

// Edit state
let _editingId = null;
let _backupData = null;

// ═══════════════════════════════════════════════════════════════
// 1. COMPANY SETTINGS
// ═══════════════════════════════════════════════════════════════

async function loadSettings() {
  if (!db) return;
  let { data, error } = await db.from('company_settings').select('*').limit(1).single();

  if (error || !data) {
    // Insert default row
    const { data: inserted } = await db.from('company_settings').insert({
      company_name: 'Your Company Name'
    }).select().single();
    data = inserted;
  }

  if (!data) return;
  APP.settings = data;

  setVal('s-name',     data.company_name);
  setVal('s-addr',     data.address);
  setVal('s-phone',    data.phone);
  setVal('s-email',    data.email);
  setVal('s-gst',      data.gstin);
  setVal('s-pan',      data.pan);
  setVal('s-logo',     data.logo_url);
  setVal('s-gstpct',   data.gst_pct_default || 18);

  const showAmtEl = document.getElementById('s-showamt');
  const gstDefEl  = document.getElementById('s-gstdef');
  if (showAmtEl) showAmtEl.checked = data.show_amount_on_print !== false;
  if (gstDefEl)  gstDefEl.checked  = data.gst_enabled_default === true;

  // Update sidebar brand
  const brandEl = document.getElementById('company-brand');
  if (brandEl && data.company_name) brandEl.textContent = data.company_name.toUpperCase().slice(0,12);
}

async function saveSettings() {
  if (!db) return;
  const btn = document.querySelector('#pg-settings .btn-pri[onclick="saveSettings()"]');
  setBtnLoading(btn, true, 'SAVING...');

  const vals = {
    company_name:        getVal('s-name'),
    address:             getVal('s-addr'),
    phone:               getVal('s-phone'),
    email:               getVal('s-email'),
    gstin:               getVal('s-gst'),
    pan:                 getVal('s-pan'),
    logo_url:            getVal('s-logo'),
    gst_pct_default:     parseInt(getVal('s-gstpct') || 18),
    show_amount_on_print: document.getElementById('s-showamt')?.checked !== false,
    gst_enabled_default:  document.getElementById('s-gstdef')?.checked === true,
  };

  try {
    const { data: existing } = await db.from('company_settings').select('id').limit(1).single();
    let error;
    if (existing) {
      ({ error } = await db.from('company_settings').update(vals).eq('id', existing.id));
    } else {
      ({ error } = await db.from('company_settings').insert(vals));
    }
    if (error) throw error;

    APP.settings = { ...APP.settings, ...vals };
    const brandEl = document.getElementById('company-brand');
    if (brandEl && vals.company_name) brandEl.textContent = vals.company_name.toUpperCase().slice(0,12);

    auditLog('UPDATE', 'settings', 'company_settings', 'Company settings updated');
    toast('Settings saved successfully', 'ok');
  } catch(e) {
    toast('Failed to save settings: ' + e.message, 'err');
  } finally {
    setBtnLoading(btn, false);
  }
}

// ═══════════════════════════════════════════════════════════════
// 2. BRANCHES
// ═══════════════════════════════════════════════════════════════

async function loadMastersBranches() {
  if (!db) return;
  const { data, error } = await db.from('branches').select('*').order('name');
  const tbody = document.getElementById('branches-tbody');
  if (!tbody) return;

  if (error || !data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty"><div class="empty-txt">No branches found</div></td></tr>`;
    return;
  }

  tbody.innerHTML = data.map(b => `<tr>
    <td class="td-pri">${b.name}</td>
    <td>${b.city || '—'}</td>
    <td>${b.address || '—'}</td>
    <td class="td-muted">${b.phone || '—'}</td>
    <td><span class="tag tag-${b.is_active ? 'delivered' : 'cancelled'}">${b.is_active ? 'Active' : 'Inactive'}</span></td>
    <td><button class="btn btn-ghost btn-xs" onclick="editBranch('${b.id}')">EDIT</button></td>
  </tr>`).join('');
}

function openAddBranch() {
  _editingId = null;
  setVal('branch-name',    '');
  setVal('branch-city',    '');
  setVal('branch-address', '');
  setVal('branch-phone',   '');
  document.querySelector('#branchModal .mhd-title').textContent = 'ADD BRANCH';
  M('branchModal');
}

async function editBranch(id) {
  const { data } = await db.from('branches').select('*').eq('id', id).single();
  if (!data) return;
  _editingId = id;
  setVal('branch-name',    data.name);
  setVal('branch-city',    data.city);
  setVal('branch-address', data.address);
  setVal('branch-phone',   data.phone);
  document.querySelector('#branchModal .mhd-title').textContent = 'EDIT BRANCH';
  M('branchModal');
}

async function saveBranch() {
  const name    = getVal('branch-name');
  const city    = getVal('branch-city');
  const address = getVal('branch-address');
  const phone   = getVal('branch-phone');

  if (!name) { toast('Branch name is required', 'err'); return; }

  const btn = document.querySelector('#branchModal .btn-pri');
  setBtnLoading(btn, true, 'SAVING...');
  try {
    const vals = { name, city, address, phone };
    let error;
    if (_editingId) {
      ({ error } = await db.from('branches').update(vals).eq('id', _editingId));
    } else {
      ({ error } = await db.from('branches').insert(vals));
    }
    if (error) throw error;

    // Reload cache
    const { data: branches } = await db.from('branches').select('*').eq('is_active', true).order('name');
    if (branches) APP.cache.branches = branches;
    populateAllDropdowns();

    auditLog(_editingId ? 'UPDATE' : 'CREATE', 'branch', _editingId || 'new', name);
    toast('Branch saved', 'ok');
    C('branchModal');
    loadMastersBranches();
    _editingId = null;
  } catch(e) {
    toast('Failed to save branch: ' + e.message, 'err');
  } finally {
    setBtnLoading(btn, false);
  }
}

// ═══════════════════════════════════════════════════════════════
// 3. PARTIES
// ═══════════════════════════════════════════════════════════════

async function loadMastersParties() {
  if (!db) return;
  showTableSkeleton('parties-master-tbody', 6);
  const { page, pageSize } = APP.pagination.parties_master;
  const from = (page - 1) * pageSize, to = from + pageSize - 1;

  const searchQ  = getVal('party-filter-search');
  const typeFilter = getVal('party-filter-type');

  let q = db.from('parties')
    .select('*', { count: 'exact' })
    .order('name')
    .range(from, to);

  if (searchQ)    q = q.ilike('name', `%${searchQ}%`);
  if (typeFilter) q = q.eq('type', typeFilter);

  const { data, count, error } = await q;
  APP.pagination.parties_master.total = count || 0;

  const tbody = document.getElementById('parties-master-tbody');
  if (error || !data || data.length === 0) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="empty"><div class="empty-txt">No parties found</div></td></tr>`;
  } else {
    tbody.innerHTML = data.map(p => `<tr>
      <td class="td-pri">${p.name}</td>
      <td><span class="tag tag-${p.type==='consignor'?'topay':p.type==='consignee'?'booked':'credit'}">${capitalize(p.type)}</span></td>
      <td class="td-muted">${p.mobile || '—'}</td>
      <td style="font-family:var(--font-mono);font-size:11px">${p.gstin || '—'}</td>
      <td class="td-num">₹${num(p.credit_limit || 0)}</td>
      <td class="td-num ${p.outstanding_balance > 0 ? 'bal-dr' : ''}">₹${num(p.outstanding_balance || 0)}</td>
      <td><div class="row gap14">
        <button class="btn btn-ghost btn-xs" onclick="editParty('${p.id}')">EDIT</button>
        ${p.is_active ? `<button class="btn btn-danger btn-xs" onclick="deactivateParty('${p.id}','${p.name}')">DEACTIVATE</button>` : `<span class="tag tag-cancelled">INACTIVE</span>`}
      </div></td>
    </tr>`).join('');
  }
  renderPagination('pag-parties-master', 'parties_master');
}

function openAddParty() {
  _editingId = null;
  resetFormInputs('partyModal');
  document.querySelector('#partyModal .mhd-title').textContent = 'ADD PARTY';
  M('partyModal');
}

async function editParty(id) {
  const { data } = await db.from('parties').select('*').eq('id', id).single();
  if (!data) return;
  _editingId = id;
  setVal('party-name',    data.name);
  setVal('party-mobile',  data.mobile);
  setVal('party-email',   data.email);
  setVal('party-gstin',   data.gstin);
  setVal('party-pan',     data.pan);
  setVal('party-address', data.address);
  setVal('party-city',    data.city);
  setVal('party-state',   data.state);
  setVal('party-credit',  data.credit_limit);
  const typeEl = document.querySelector('#partyModal select[id="party-type"]');
  if (typeEl) typeEl.value = data.type;
  document.querySelector('#partyModal .mhd-title').textContent = 'EDIT PARTY';
  M('partyModal');
}

async function saveParty() {
  const name  = getVal('party-name');
  const type  = document.querySelector('#partyModal select[id="party-type"]')?.value || 'both';
  if (!name) { toast('Party name is required', 'err'); return; }
  if (!type) { toast('Type is required', 'err'); return; }

  const btn = document.querySelector('#partyModal .btn-pri[onclick="saveParty()"]');
  setBtnLoading(btn, true, 'SAVING...');
  try {
    const vals = {
      name, type,
      mobile:       getVal('party-mobile'),
      email:        getVal('party-email'),
      gstin:        getVal('party-gstin'),
      pan:          getVal('party-pan'),
      address:      getVal('party-address'),
      city:         getVal('party-city'),
      state:        getVal('party-state'),
      credit_limit: parseFloat(getVal('party-credit') || 0),
    };
    let error;
    if (_editingId) {
      ({ error } = await db.from('parties').update(vals).eq('id', _editingId));
    } else {
      ({ error } = await db.from('parties').insert(vals));
    }
    if (error) throw error;

    const { data: parties } = await db.from('parties').select('*').eq('is_active', true).order('name');
    if (parties) APP.cache.parties = parties;
    populateAllDropdowns();

    auditLog(_editingId ? 'UPDATE' : 'CREATE', 'party', _editingId || 'new', name);
    toast('Party saved', 'ok');
    C('partyModal');
    loadMastersParties();
    _editingId = null;
  } catch(e) {
    toast('Failed to save party: ' + e.message, 'err');
  } finally {
    setBtnLoading(btn, false);
  }
}

async function deactivateParty(id, name) {
  const ok = await confirmAction(`Deactivate party "${name}"? They will be hidden from dropdowns.`);
  if (!ok) return;
  await db.from('parties').update({ is_active: false }).eq('id', id);
  const { data: parties } = await db.from('parties').select('*').eq('is_active', true).order('name');
  if (parties) APP.cache.parties = parties;
  populateAllDropdowns();
  toast('Party deactivated', 'ok');
  loadMastersParties();
}

// ═══════════════════════════════════════════════════════════════
// 4. DRIVERS
// ═══════════════════════════════════════════════════════════════

async function loadMastersDrivers() {
  if (!db) return;
  showTableSkeleton('drivers-master-tbody', 5);
  const { page, pageSize } = APP.pagination.drivers_master;
  const from = (page - 1) * pageSize, to = from + pageSize - 1;

  const { data, count, error } = await db.from('drivers')
    .select('*', { count: 'exact' }).order('name').range(from, to);
  APP.pagination.drivers_master.total = count || 0;

  const tbody = document.getElementById('drivers-master-tbody');
  const in30days = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

  if (error || !data || data.length === 0) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="empty"><div class="empty-txt">No drivers found</div></td></tr>`;
  } else {
    tbody.innerHTML = data.map(d => {
      const licenseExpiring = d.license_expiry_date && d.license_expiry_date <= in30days;
      return `<tr>
        <td class="td-pri">${d.name}</td>
        <td class="td-muted">${d.mobile}</td>
        <td style="font-family:var(--font-mono);font-size:11px">${d.license_no}</td>
        <td>${d.license_expiry_date ? `${formatDate(d.license_expiry_date)} ${licenseExpiring ? '<span class="tag tag-expiring">EXPIRING</span>' : ''}` : '—'}</td>
        <td><span class="tag tag-${d.is_active ? 'delivered' : 'cancelled'}">${d.is_active ? 'Active' : 'Inactive'}</span></td>
        <td><div class="row gap14">
          <button class="btn btn-ghost btn-xs" onclick="editDriver('${d.id}')">EDIT</button>
          ${d.is_active ? `<button class="btn btn-danger btn-xs" onclick="deactivateDriver('${d.id}','${d.name}')">DEACTIVATE</button>` : ''}
        </div></td>
      </tr>`;
    }).join('');
  }
  renderPagination('pag-drivers-master', 'drivers_master');
}

function openAddDriver() {
  _editingId = null;
  setVal('driver-name',    '');
  setVal('driver-mobile',  '');
  setVal('driver-license', '');
  setVal('driver-expiry',  '');
  document.querySelector('#driverModal .mhd-title').textContent = 'ADD DRIVER';
  M('driverModal');
}

async function editDriver(id) {
  const { data } = await db.from('drivers').select('*').eq('id', id).single();
  if (!data) return;
  _editingId = id;
  setVal('driver-name',    data.name);
  setVal('driver-mobile',  data.mobile);
  setVal('driver-license', data.license_no);
  setVal('driver-expiry',  data.license_expiry_date);
  document.querySelector('#driverModal .mhd-title').textContent = 'EDIT DRIVER';
  M('driverModal');
}

async function saveDriver() {
  const name    = getVal('driver-name');
  const mobile  = getVal('driver-mobile');
  const license = getVal('driver-license');
  const expiry  = getVal('driver-expiry');

  if (!name)    { toast('Driver name is required', 'err'); return; }
  if (!mobile)  { toast('Mobile number is required', 'err'); return; }
  if (!license) { toast('License number is required', 'err'); return; }

  const btn = document.querySelector('#driverModal .btn-pri[onclick="saveDriver()"]');
  setBtnLoading(btn, true, 'SAVING...');
  try {
    const vals = { name, mobile, license_no: license, license_expiry_date: expiry || null };
    let error;
    if (_editingId) {
      ({ error } = await db.from('drivers').update(vals).eq('id', _editingId));
    } else {
      ({ error } = await db.from('drivers').insert(vals));
    }
    if (error) throw error;

    const { data: drivers } = await db.from('drivers').select('*').eq('is_active', true).order('name');
    if (drivers) APP.cache.drivers = drivers;
    populateAllDropdowns();

    toast('Driver saved', 'ok');
    C('driverModal');
    loadMastersDrivers();
    _editingId = null;
  } catch(e) {
    toast('Failed to save driver: ' + e.message, 'err');
  } finally {
    setBtnLoading(btn, false);
  }
}

async function deactivateDriver(id, name) {
  const ok = await confirmAction(`Deactivate driver "${name}"?`);
  if (!ok) return;
  await db.from('drivers').update({ is_active: false }).eq('id', id);
  const { data: drivers } = await db.from('drivers').select('*').eq('is_active', true).order('name');
  if (drivers) APP.cache.drivers = drivers;
  populateAllDropdowns();
  toast('Driver deactivated', 'ok');
  loadMastersDrivers();
}

// ═══════════════════════════════════════════════════════════════
// 5. VEHICLES
// ═══════════════════════════════════════════════════════════════

async function loadMastersVehicles() {
  if (!db) return;
  showTableSkeleton('vehicles-master-tbody', 5);
  const { page, pageSize } = APP.pagination.vehicles_master;
  const from = (page - 1) * pageSize, to = from + pageSize - 1;

  const { data, count, error } = await db.from('vehicles')
    .select('*', { count: 'exact' }).order('vehicle_no').range(from, to);
  APP.pagination.vehicles_master.total = count || 0;

  const tbody = document.getElementById('vehicles-master-tbody');
  if (error || !data || data.length === 0) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="empty"><div class="empty-txt">No vehicles found</div></td></tr>`;
  } else {
    tbody.innerHTML = data.map(v => `<tr>
      <td style="font-family:var(--font-mono);font-size:12px;font-weight:600;color:var(--accent-bright)">${v.vehicle_no}</td>
      <td class="td-pri">${v.owner_name || '—'}</td>
      <td class="td-muted">${v.mobile || '—'}</td>
      <td class="td-muted">${v.vehicle_type || '—'}</td>
      <td><span class="tag tag-${v.is_active ? 'delivered' : 'cancelled'}">${v.is_active ? 'Active' : 'Inactive'}</span></td>
      <td><div class="row gap14">
        <button class="btn btn-ghost btn-xs" onclick="editVehicle('${v.id}')">EDIT</button>
        ${v.is_active ? `<button class="btn btn-danger btn-xs" onclick="deactivateVehicle('${v.id}','${v.vehicle_no}')">DEACTIVATE</button>` : ''}
      </div></td>
    </tr>`).join('');
  }
  renderPagination('pag-vehicles-master', 'vehicles_master');
}

function openAddVehicle() {
  _editingId = null;
  setVal('vehicle-no',   '');
  setVal('vehicle-owner','');
  setVal('vehicle-mobile','');
  setVal('vehicle-type', '');
  document.querySelector('#vehicleModal .mhd-title').textContent = 'ADD VEHICLE';
  M('vehicleModal');
}

async function editVehicle(id) {
  const { data } = await db.from('vehicles').select('*').eq('id', id).single();
  if (!data) return;
  _editingId = id;
  setVal('vehicle-no',    data.vehicle_no);
  setVal('vehicle-owner', data.owner_name);
  setVal('vehicle-mobile',data.mobile);
  setVal('vehicle-type',  data.vehicle_type);
  document.querySelector('#vehicleModal .mhd-title').textContent = 'EDIT VEHICLE';
  M('vehicleModal');
}

async function saveVehicle() {
  const vehicleNo = getVal('vehicle-no')?.toUpperCase();
  if (!vehicleNo) { toast('Vehicle number is required', 'err'); return; }

  const btn = document.querySelector('#vehicleModal .btn-pri[onclick="saveVehicle()"]');
  setBtnLoading(btn, true, 'SAVING...');
  try {
    const vals = {
      vehicle_no:   vehicleNo,
      owner_name:   getVal('vehicle-owner'),
      mobile:       getVal('vehicle-mobile'),
      vehicle_type: getVal('vehicle-type'),
    };
    let error;
    if (_editingId) {
      ({ error } = await db.from('vehicles').update(vals).eq('id', _editingId));
    } else {
      ({ error } = await db.from('vehicles').insert(vals));
    }
    if (error) throw error;

    const { data: vehicles } = await db.from('vehicles').select('*').eq('is_active', true).order('vehicle_no');
    if (vehicles) APP.cache.vehicles = vehicles;
    populateAllDropdowns();

    toast('Vehicle saved', 'ok');
    C('vehicleModal');
    loadMastersVehicles();
    _editingId = null;
  } catch(e) {
    toast('Failed to save vehicle: ' + e.message, 'err');
  } finally {
    setBtnLoading(btn, false);
  }
}

async function deactivateVehicle(id, vehicleNo) {
  const ok = await confirmAction(`Deactivate vehicle ${vehicleNo}?`);
  if (!ok) return;
  await db.from('vehicles').update({ is_active: false }).eq('id', id);
  const { data: vehicles } = await db.from('vehicles').select('*').eq('is_active', true).order('vehicle_no');
  if (vehicles) APP.cache.vehicles = vehicles;
  populateAllDropdowns();
  toast('Vehicle deactivated', 'ok');
  loadMastersVehicles();
}

// ═══════════════════════════════════════════════════════════════
// 6. BROKERS
// ═══════════════════════════════════════════════════════════════

async function loadMastersBrokers() {
  if (!db) return;
  const { data, error } = await db.from('brokers').select('*').order('name');
  const tbody = document.getElementById('brokers-tbody');
  if (!tbody) return;

  if (error || !data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" class="empty"><div class="empty-txt">No brokers found</div></td></tr>`;
    return;
  }

  tbody.innerHTML = data.map(b => `<tr>
    <td class="td-pri">${b.name}</td>
    <td class="td-num">${parseFloat(b.commission_percent || 0).toFixed(2)}%</td>
    <td class="td-muted">${b.mobile || '—'}</td>
    <td><div class="row gap14">
      <button class="btn btn-ghost btn-xs" onclick="editBroker('${b.id}')">EDIT</button>
      ${b.is_active ? `<button class="btn btn-danger btn-xs" onclick="deactivateBroker('${b.id}','${b.name}')">DEACTIVATE</button>` : `<span class="tag tag-cancelled">INACTIVE</span>`}
    </div></td>
  </tr>`).join('');
}

function openAddBroker() {
  _editingId = null;
  setVal('broker-name',       '');
  setVal('broker-mobile',     '');
  setVal('broker-commission', '');
  document.querySelector('#brokerModal .mhd-title').textContent = 'ADD BROKER';
  M('brokerModal');
}

async function editBroker(id) {
  const { data } = await db.from('brokers').select('*').eq('id', id).single();
  if (!data) return;
  _editingId = id;
  setVal('broker-name',       data.name);
  setVal('broker-mobile',     data.mobile);
  setVal('broker-commission', data.commission_percent);
  document.querySelector('#brokerModal .mhd-title').textContent = 'EDIT BROKER';
  M('brokerModal');
}

async function saveBroker() {
  const name = getVal('broker-name');
  if (!name) { toast('Broker name is required', 'err'); return; }

  const btn = document.querySelector('#brokerModal .btn-pri[onclick="saveBroker()"]');
  setBtnLoading(btn, true, 'SAVING...');
  try {
    const vals = {
      name,
      mobile:             getVal('broker-mobile'),
      commission_percent: parseFloat(getVal('broker-commission') || 0),
    };
    let error;
    if (_editingId) {
      ({ error } = await db.from('brokers').update(vals).eq('id', _editingId));
    } else {
      ({ error } = await db.from('brokers').insert(vals));
    }
    if (error) throw error;

    const { data: brokers } = await db.from('brokers').select('*').eq('is_active', true).order('name');
    if (brokers) APP.cache.brokers = brokers;
    populateAllDropdowns();

    toast('Broker saved', 'ok');
    C('brokerModal');
    loadMastersBrokers();
    _editingId = null;
  } catch(e) {
    toast('Failed to save broker: ' + e.message, 'err');
  } finally {
    setBtnLoading(btn, false);
  }
}

async function deactivateBroker(id, name) {
  const ok = await confirmAction(`Deactivate broker "${name}"?`);
  if (!ok) return;
  await db.from('brokers').update({ is_active: false }).eq('id', id);
  const { data: brokers } = await db.from('brokers').select('*').eq('is_active', true).order('name');
  if (brokers) APP.cache.brokers = brokers;
  populateAllDropdowns();
  toast('Broker deactivated', 'ok');
  loadMastersBrokers();
}

// ═══════════════════════════════════════════════════════════════
// 7. RATE CHART
// ═══════════════════════════════════════════════════════════════

async function loadMastersRates() {
  if (!db) return;
  const { data, error } = await db.from('rate_chart').select('*').order('from_city');
  const tbody = document.getElementById('rates-tbody');
  if (!tbody) return;

  if (error || !data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty"><div class="empty-txt">No rates defined</div></td></tr>`;
    return;
  }

  tbody.innerHTML = data.map(r => `<tr>
    <td class="td-pri">${r.from_city}</td>
    <td class="td-pri">${r.to_city}</td>
    <td class="r td-num">₹${parseFloat(r.rate_per_kg).toFixed(2)}</td>
    <td class="r td-muted">${r.min_charge > 0 ? '₹'+num(r.min_charge) : '—'}</td>
    <td><div class="row gap14">
      <button class="btn btn-ghost btn-xs" onclick="editRate('${r.id}')">EDIT</button>
      <button class="btn btn-danger btn-xs" onclick="deleteRate('${r.id}','${r.from_city}→${r.to_city}')">DELETE</button>
    </div></td>
  </tr>`).join('');
}

function openAddRate() {
  _editingId = null;
  setVal('rate-from',   '');
  setVal('rate-to',     '');
  setVal('rate-per-kg', '');
  setVal('rate-min',    '');
  setVal('rate-date',   today());
  document.querySelector('#rateModal .mhd-title').textContent = 'ADD RATE';
  M('rateModal');
}

async function editRate(id) {
  const { data } = await db.from('rate_chart').select('*').eq('id', id).single();
  if (!data) return;
  _editingId = id;
  setVal('rate-from',   data.from_city);
  setVal('rate-to',     data.to_city);
  setVal('rate-per-kg', data.rate_per_kg);
  setVal('rate-min',    data.min_charge);
  setVal('rate-date',   data.effective_date);
  document.querySelector('#rateModal .mhd-title').textContent = 'EDIT RATE';
  M('rateModal');
}

async function saveRate() {
  const fromCity  = getVal('rate-from');
  const toCity    = getVal('rate-to');
  const ratePerKg = parseFloat(getVal('rate-per-kg'));

  if (!fromCity)       { toast('From city is required', 'err'); return; }
  if (!toCity)         { toast('To city is required', 'err'); return; }
  if (!ratePerKg || ratePerKg <= 0) { toast('Rate must be > 0', 'err'); return; }

  const btn = document.querySelector('#rateModal .btn-pri[onclick="saveRate()"]');
  setBtnLoading(btn, true, 'SAVING...');
  try {
    const vals = {
      from_city: fromCity, to_city: toCity, rate_per_kg: ratePerKg,
      min_charge: parseFloat(getVal('rate-min') || 0),
      effective_date: getVal('rate-date') || today(),
    };
    let error;
    if (_editingId) {
      ({ error } = await db.from('rate_chart').update(vals).eq('id', _editingId));
    } else {
      ({ error } = await db.from('rate_chart').insert(vals));
    }
    if (error) throw error;

    const { data: rates } = await db.from('rate_chart').select('*').order('from_city');
    if (rates) APP.cache.rates = rates;

    toast('Rate saved', 'ok');
    C('rateModal');
    loadMastersRates();
    _editingId = null;
  } catch(e) {
    toast('Failed to save rate: ' + e.message, 'err');
  } finally {
    setBtnLoading(btn, false);
  }
}

async function deleteRate(id, label) {
  const ok = await confirmAction(`Delete rate for ${label}?`);
  if (!ok) return;
  await db.from('rate_chart').delete().eq('id', id);
  const { data: rates } = await db.from('rate_chart').select('*').order('from_city');
  if (rates) APP.cache.rates = rates;
  toast('Rate deleted', 'ok');
  loadMastersRates();
}

// ═══════════════════════════════════════════════════════════════
// 8. NUMBER SERIES
// ═══════════════════════════════════════════════════════════════

async function loadMastersSeries() {
  if (!db) return;
  const { data, error } = await db.from('number_series')
    .select('*, branch:branch_id(name)')
    .eq('branch_id', APP.branch.id)
    .order('module');

  const tbody = document.getElementById('series-tbody');
  if (!tbody) return;

  if (error || !data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty"><div class="empty-txt">No number series configured for current branch</div></td></tr>`;
    return;
  }

  tbody.innerHTML = data.map(s => {
    const nextNum = s.prefix + String((s.last_number || 0) + 1).padStart(s.pad_width || 6, '0');
    return `<tr>
      <td class="td-pri">${capitalize(s.module)}</td>
      <td style="font-family:var(--font-mono)">${s.prefix}</td>
      <td class="td-num">${String(s.last_number || 0).padStart(s.pad_width || 6, '0')}</td>
      <td class="td-num" style="color:var(--accent-bright)">${nextNum}</td>
      <td class="td-muted">${s.branch?.name || '—'}</td>
      <td><div class="row gap14">
        ${APP.user.role === 'admin' ? `
          <button class="btn btn-ghost btn-xs" onclick="editSeries('${s.id}','${s.prefix}','${s.last_number}')">EDIT</button>
        ` : ''}
      </div></td>
    </tr>`;
  }).join('');
}

async function editSeries(id, prefix, lastNum) {
  const newPrefix = prompt(`Edit prefix (current: ${prefix}):`);
  if (newPrefix === null) return;
  const ok = await confirmAction(`Change prefix to "${newPrefix || prefix}"? This will affect all new records.`);
  if (!ok) return;
  await db.from('number_series').update({ prefix: newPrefix || prefix }).eq('id', id);
  toast('Series prefix updated', 'ok');
  loadMastersSeries();
}

// ═══════════════════════════════════════════════════════════════
// 9. USERS & ROLES
// ═══════════════════════════════════════════════════════════════

async function loadUsers() {
  if (!db) return;
  const { data, error } = await db.from('users')
    .select('*, branch:branch_id(name)')
    .order('name');

  const tbody = document.getElementById('users-tbody');
  if (!tbody) return;

  if (error || !data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty"><div class="empty-txt">No users found</div></td></tr>`;
    return;
  }

  const roleTagMap = { admin: 'topay', manager: 'transit', operator: 'booked', accountant: 'credit' };
  tbody.innerHTML = data.map(u => `<tr>
    <td class="td-pri">${u.name}</td>
    <td class="td-muted">${u.email}</td>
    <td class="td-muted">${u.mobile || '—'}</td>
    <td><span class="tag tag-${roleTagMap[u.role] || 'draft'}">${u.role.toUpperCase()}</span></td>
    <td>${u.branch?.name || 'All Branches'}</td>
    <td><span class="tag tag-${u.is_active ? 'delivered' : 'cancelled'}">${u.is_active ? 'Active' : 'Inactive'}</span></td>
    <td class="td-muted">${u.last_login ? formatDateTime(u.last_login) : 'Never'}</td>
    <td><div class="row gap14">
      <button class="btn btn-ghost btn-xs" onclick="editUser('${u.id}')">EDIT</button>
      ${u.is_active && u.id !== APP.user.id ? `<button class="btn btn-danger btn-xs" onclick="deactivateUser('${u.id}','${u.name}')">DEACTIVATE</button>` : ''}
    </div></td>
  </tr>`).join('');
}

function openAddUser() {
  _editingId = null;
  setVal('user-name',  '');
  setVal('user-email', '');
  setVal('user-mobile','');
  setVal('user-pass',  '');
  document.querySelector('#userModal .mhd-title').textContent = 'ADD USER';
  M('userModal');
}

async function editUser(id) {
  const { data } = await db.from('users').select('*').eq('id', id).single();
  if (!data) return;
  _editingId = id;
  setVal('user-name',  data.name);
  setVal('user-email', data.email);
  setVal('user-mobile',data.mobile);
  const roleEl   = document.querySelector('#userModal select[id="user-role"]');
  const branchEl = document.querySelector('#userModal .sel-branch');
  if (roleEl)   roleEl.value   = data.role;
  if (branchEl) branchEl.value = data.branch_id;
  document.querySelector('#userModal .mhd-title').textContent = 'EDIT USER';
  M('userModal');
}

async function saveUser() {
  const name     = getVal('user-name');
  const email    = getVal('user-email');
  const mobile   = getVal('user-mobile');
  const password = getVal('user-pass');
  const active   = document.getElementById('user-active')?.checked !== false;
  const role     = document.querySelector('#userModal #user-role-select')?.value || 'operator';
  const branchEl = document.querySelector('#userModal .sel-branch');
  const branchId = branchEl?.value || APP.branch.id;

  if (!name)  { toast('Name is required', 'err'); return; }
  if (!email) { toast('Email is required', 'err'); return; }
  if (!_editingId && !password) { toast('Password is required for new users', 'err'); return; }
  if (!_editingId && password.length < 6) { toast('Password must be at least 6 characters', 'err'); return; }

  const btn = document.querySelector('#userModal .btn-pri[onclick="saveUser()"]');
  setBtnLoading(btn, true, 'SAVING...');
  try {
    const vals = { name, email, mobile, role, branch_id: branchId, is_active: active };

    // Hash password via Supabase RPC if provided
    if (password) {
      const { data: hashed, error: hashErr } = await db.rpc('hash_password', { plain: password });
      if (hashErr) {
        // Fallback: store plain text if hash function not yet deployed (schema not updated)
        vals.password_hash = password;
        toast('Warning: password stored without hashing — run schema.sql first', 'warn');
      } else {
        vals.password_hash = hashed;
      }
    }

    let error;
    if (_editingId) {
      // On edit: only update password_hash if a new password was provided
      const updateVals = { name, email, mobile, role, branch_id: branchId, is_active: active };
      if (password && vals.password_hash) updateVals.password_hash = vals.password_hash;
      ({ error } = await db.from('users').update(updateVals).eq('id', _editingId));
    } else {
      ({ error } = await db.from('users').insert(vals));
    }

    if (error) throw error;
    auditLog(_editingId ? 'UPDATE' : 'CREATE', 'user', _editingId || 'new', name);
    toast(_editingId ? 'User updated' : 'User created — they can now log in', 'ok');
    C('userModal');
    loadUsers();
    _editingId = null;
  } catch(e) {
    toast('Failed to save user: ' + e.message, 'err');
  } finally {
    setBtnLoading(btn, false);
  }
}

async function deactivateUser(id, name) {
  if (id === APP.user.id) { toast('Cannot deactivate your own account', 'err'); return; }
  const ok = await confirmAction(`Deactivate user "${name}"? They will lose access.`);
  if (!ok) return;
  await db.from('users').update({ is_active: false }).eq('id', id);
  auditLog('UPDATE', 'user', id, name + ' deactivated');
  toast('User deactivated', 'ok');
  loadUsers();
}

// ═══════════════════════════════════════════════════════════════
// 10. AUDIT LOG
// ═══════════════════════════════════════════════════════════════

async function loadAuditLog() {
  if (!db) return;
  showTableSkeleton('auditlog-tbody', 6);
  const { page, pageSize } = APP.pagination.auditlog;
  const from = (page - 1) * pageSize, to = from + pageSize - 1;

  const userFilter   = getVal('audit-filter-user');
  const moduleFilter = getVal('audit-filter-module');
  const actionFilter = getVal('audit-filter-action');
  const dateFilter   = getVal('audit-filter-date');

  let q = db.from('audit_log')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (userFilter)   q = q.ilike('user_name', `%${userFilter}%`);
  if (moduleFilter) q = q.eq('module', moduleFilter);
  if (actionFilter) q = q.eq('action', actionFilter);
  if (dateFilter)   q = q.gte('created_at', dateFilter + 'T00:00:00').lte('created_at', dateFilter + 'T23:59:59');

  const { data, count, error } = await q;
  APP.pagination.auditlog.total = count || 0;

  const tbody = document.getElementById('auditlog-tbody');
  const actionTagMap = {
    CREATE: 'delivered', UPDATE: 'booked', DELETE: 'cancelled',
    CANCEL: 'cancelled', DISPATCH: 'transit', LOGIN: 'credit'
  };

  if (error || !data || data.length === 0) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="empty"><div class="empty-txt">No audit records found</div></td></tr>`;
  } else {
    tbody.innerHTML = data.map(a => `<tr>
      <td style="font-family:var(--font-mono);font-size:10.5px;color:var(--text-muted)">${formatDateTime(a.created_at)}</td>
      <td class="td-pri">${a.user_name}</td>
      <td><span class="tag tag-${actionTagMap[a.action] || 'draft'}">${a.action}</span></td>
      <td class="td-muted">${capitalize(a.module)}</td>
      <td class="td-id">${a.record_ref || a.record_id || '—'}</td>
      <td class="td-muted" style="font-size:10.5px">${a.details ? (typeof a.details === 'string' ? a.details.slice(0, 60) : JSON.stringify(a.details).slice(0, 60)) : '—'}</td>
    </tr>`).join('');
  }
  renderPagination('pag-auditlog', 'auditlog');
}

// ═══════════════════════════════════════════════════════════════
// 11. BACKUP & RESTORE
// ═══════════════════════════════════════════════════════════════

async function doBackup() {
  if (!db) { toast('Not connected to database', 'err'); return; }
  toast('Preparing backup — fetching all data...', 'i');

  try {
    const [
      settings, branches, users, parties, drivers, vehicles, brokers,
      rates, series, bookings, lorryReceipts, manifests, manifestLrs, payments, expenses
    ] = await Promise.all([
      db.from('company_settings').select('*'),
      db.from('branches').select('*'),
      db.from('users').select('*'),
      db.from('parties').select('*'),
      db.from('drivers').select('*'),
      db.from('vehicles').select('*'),
      db.from('brokers').select('*'),
      db.from('rate_chart').select('*'),
      db.from('number_series').select('*'),
      db.from('bookings').select('*'),
      db.from('lorry_receipts').select('*'),
      db.from('manifests').select('*'),
      db.from('manifest_lrs').select('*'),
      db.from('payments').select('*'),
      db.from('expenses').select('*'),
    ]);

    const type   = getVal('backupType') || 'full';
    const backup = {
      meta: {
        version: '4.0',
        type,
        created_at: new Date().toISOString(),
        created_by: APP.user.name,
        branch: APP.branch.name,
      },
      company_settings: settings.data || [],
      branches:         branches.data || [],
      users:            users.data    || [],
      parties:          parties.data  || [],
      drivers:          drivers.data  || [],
      vehicles:         vehicles.data || [],
      brokers:          brokers.data  || [],
      rate_chart:       rates.data    || [],
      number_series:    series.data   || [],
      bookings:         bookings.data || [],
      lorry_receipts:   lorryReceipts.data || [],
      manifests:        manifests.data     || [],
      manifest_lrs:     manifestLrs.data   || [],
      payments:         payments.data      || [],
      expenses:         expenses.data      || [],
    };

    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `freight_erp_backup_${today()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Backup downloaded successfully', 'ok');
  } catch(e) {
    toast('Backup failed: ' + e.message, 'err');
  }
}

function readBackupFile(e) {
  const file = e.target?.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result);
      _backupData = data;
      document.getElementById('restore-preview').style.display = '';
      document.getElementById('restore-info').innerHTML = `
        <strong>${data.meta?.type || 'full'} backup</strong><br>
        Created: ${data.meta?.created_at?.slice(0, 19)?.replace('T',' ') || 'unknown'}<br>
        LRs: ${data.lorry_receipts?.length || 0} ·
        Bookings: ${data.bookings?.length || 0} ·
        Parties: ${data.parties?.length || 0} ·
        Manifests: ${data.manifests?.length || 0}
      `;
      const restoreBtn = document.getElementById('restoreBtn');
      if (restoreBtn) restoreBtn.removeAttribute('disabled');
      toast('Backup file loaded — ready to restore', 'ok');
    } catch(err) {
      toast('Invalid backup file — not valid JSON', 'err');
    }
  };
  reader.readAsText(file);
}

function handleDrop(e) {
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0];
  if (file) readBackupFile({ target: { files: [file] } });
  e.currentTarget.style.borderColor = 'var(--border-2)';
}

async function doRestore() {
  if (!_backupData || !db) { toast('Load a backup file first', 'warn'); return; }
  const ok = await confirmAction('This will OVERWRITE existing data with the backup. This cannot be undone. Continue?');
  if (!ok) return;

  const d = _backupData;
  try {
    toast('Restoring company settings...', 'i');
    if (d.company_settings?.length) await db.from('company_settings').upsert(d.company_settings);

    toast('Restoring branches...', 'i');
    if (d.branches?.length) await db.from('branches').upsert(d.branches);

    toast('Restoring masters...', 'i');
    await Promise.all([
      d.parties?.length  ? db.from('parties').upsert(d.parties)   : Promise.resolve(),
      d.drivers?.length  ? db.from('drivers').upsert(d.drivers)   : Promise.resolve(),
      d.vehicles?.length ? db.from('vehicles').upsert(d.vehicles) : Promise.resolve(),
      d.brokers?.length  ? db.from('brokers').upsert(d.brokers)   : Promise.resolve(),
      d.users?.length    ? db.from('users').upsert(d.users)       : Promise.resolve(),
    ]);

    toast('Restoring configuration...', 'i');
    await Promise.all([
      d.rate_chart?.length    ? db.from('rate_chart').upsert(d.rate_chart)       : Promise.resolve(),
      d.number_series?.length ? db.from('number_series').upsert(d.number_series) : Promise.resolve(),
    ]);

    toast('Restoring bookings and manifests...', 'i');
    await Promise.all([
      d.bookings?.length  ? db.from('bookings').upsert(d.bookings)   : Promise.resolve(),
      d.manifests?.length ? db.from('manifests').upsert(d.manifests) : Promise.resolve(),
    ]);

    toast('Restoring LRs...', 'i');
    if (d.lorry_receipts?.length) await db.from('lorry_receipts').upsert(d.lorry_receipts);

    toast('Restoring transactions...', 'i');
    await Promise.all([
      d.manifest_lrs?.length ? db.from('manifest_lrs').upsert(d.manifest_lrs) : Promise.resolve(),
      d.payments?.length     ? db.from('payments').upsert(d.payments)         : Promise.resolve(),
      d.expenses?.length     ? db.from('expenses').upsert(d.expenses)         : Promise.resolve(),
    ]);

    await loadAllMastersCache();
    populateAllDropdowns();
    if (typeof loadDashboard === 'function') loadDashboard();
    toast('✓ Restore completed successfully', 'ok');
  } catch(e) {
    toast('Restore failed: ' + e.message, 'err');
  }
}

// ─── Function name aliases (index.html uses these names) ───────────────────
function openBranchModal()  { openAddBranch();  }
function openBrokerModal()  { openAddBroker();  }
function openDriverModal()  { openAddDriver();  }
function openRateModal()    { openAddRate();    }
function openVehicleModal() { openAddVehicle(); }
