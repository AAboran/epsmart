'use strict';

/* =========================================================================
   Europa Pharmaceutical Deal Control — single-page frontend (no build step).
   Screens: Login, Dashboard, Deal, Approvals, User access, Archive.
   ========================================================================= */

const State = { user: null, route: { name: 'deals' }, cache: {} };

/* ---------------- API client ---------------- */
async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers: opts.body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
    body: opts.body instanceof FormData ? opts.body : opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) throw new Error((data && data.error) || 'Request failed (' + res.status + ')');
  return data;
}

/* ---------------- helpers ---------------- */
const CUR_SYMBOL = { EUR: '€', USD: '$', GBP: '£', RUB: '₽' };
function money(n, cur = 'EUR') {
  const v = Number(n) || 0;
  const s = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(v));
  const sym = CUR_SYMBOL[cur] || (cur + ' ');
  return (v < 0 ? '-' : '') + sym + s;
}
function pct(n) { return (Number(n) || 0).toFixed(1) + '%'; }
/* Small "i" button that reveals an explanation on hover or focus. */
function info(text) {
  return `<button class="ibtn" type="button" tabindex="0" aria-label="Explanation" data-tip="${esc(text)}">i</button>`;
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fdate(s) { return s ? String(s).slice(0, 10) : '—'; }
function today() { return new Date().toISOString().slice(0, 10); }
function can(...roles) { return State.user && roles.includes(State.user.role); }
const isAdmin = () => can('admin');
const isOffice = () => can('office');
const canWrite = () => can('admin', 'office');

// Mirror of the server's international amount parser, for the live preview.
function parseAmount(raw) {
  if (typeof raw === 'number') return raw;
  let s = String(raw == null ? '' : raw).trim();
  if (!s) return NaN;
  s = s.replace(/[€$£₽\s\u00A0\u202F\u2009]/g, '');
  const sign = s.startsWith('-') ? -1 : 1;
  s = s.replace(/[^0-9.,]/g, '');
  if (!s) return NaN;
  const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
  let n;
  if (lc !== -1 && ld !== -1) n = lc > ld ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (lc !== -1) { const p = s.split(','); n = (p.length > 2 || p[p.length - 1].length === 3) ? s.replace(/,/g, '') : s.replace(',', '.'); }
  else if (ld !== -1) { const p = s.split('.'); n = (p.length > 2 || p[p.length - 1].length === 3) ? s.replace(/\./g, '') : s; }
  else n = s;
  const val = parseFloat(n);
  return Number.isFinite(val) ? sign * val : NaN;
}

/* ---------------- toasts ---------------- */
function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = msg;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.remove(), 4200);
}
const ok = (m) => toast(m, 'ok');
const err = (m) => toast(m, 'err');

/* ---------------- modal ---------------- */
function openModal(title, bodyHtml, footerHtml, opts = {}) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="overlay" id="ov">
      <div class="modal ${opts.wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="modal-h"><h3>${esc(title)}</h3><button class="x" id="mx" aria-label="Close">×</button></div>
        <div class="modal-b">${bodyHtml}</div>
        ${footerHtml ? `<div class="modal-f">${footerHtml}</div>` : ''}
      </div>
    </div>`;
  const ov = document.getElementById('ov');
  const close = () => { root.innerHTML = ''; document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  document.getElementById('mx').onclick = close;
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
  const first = root.querySelector('input,select,textarea,button.primary');
  if (first) setTimeout(() => first.focus(), 30);
  return close;
}

/* ---------------- routing ---------------- */
function go(name, params = {}) { State.route = { name, ...params }; render(); }

/* ================= LOGIN ================= */
function renderLogin() {
  document.getElementById('root').innerHTML = `
    <div class="login">
      <div class="login-card">
        <img src="/img/europa-logo.png" alt="Europa Pharmaceutical" class="login-logo" />
        <div class="sub">Deal Control — internal sign in</div>
        <div class="field"><label for="u">Username</label><input id="u" autocomplete="username" /></div>
        <div class="field"><label for="p">Password</label><input id="p" type="password" autocomplete="current-password" /></div>
        <button class="btn primary" id="go" style="width:100%">Sign in</button>
        <div id="lerr" class="alert err hidden" style="margin-top:14px"></div>
        <div class="login-boran"><img src="/img/boran-coat.png" alt="" /><span>Part of the Boran&amp;Co Group</span></div>
      </div>
    </div>`;
  const submit = async () => {
    const username = document.getElementById('u').value.trim();
    const password = document.getElementById('p').value;
    try {
      State.user = await api('/login', { method: 'POST', body: { username, password } });
      go('deals');
    } catch (e) {
      const box = document.getElementById('lerr'); box.textContent = e.message; box.classList.remove('hidden');
    }
  };
  document.getElementById('go').onclick = submit;
  document.getElementById('p').addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  document.getElementById('u').focus();
}

/* ================= SHELL ================= */
function shell(title, bodyHtml, actionsHtml = '') {
  const pendingBadge = State._pendingCount ? `<span class="badge">${State._pendingCount}</span>` : '';
  const nav = [
    ['deals', 'Deals'],
    ['overview', 'Overview'],
    ['completed', 'Completed Deals', State._awaitingLetters ? `<span class="badge">${State._awaitingLetters}</span>` : ''],
    ['reports', 'Total Finances'],
    ['approvals', 'Approvals', isAdmin() ? pendingBadge : ''],
    ['users', 'User access', ''],
    ['archive', 'Archive', ''],
  ].filter(([n]) => (n === 'approvals' || n === 'users') ? isAdmin() : true);

  document.getElementById('root').innerHTML = `
    <div class="app">
      <div class="scrim hidden" id="scrim"></div>
      <aside class="sidebar" id="sidebar">
        <div class="brand"><img src="/img/europa-icon.png" alt="" class="brand-icon" /><div class="brand-tx">Europa Pharmaceutical<span>Deal Control</span></div></div>
        ${nav.map(([n, label, badge]) => `
          <button class="nav-item ${(({ deal: State._dealCompleted ? 'completed' : 'deals', flow: 'overview' })[State.route.name] || State.route.name) === n ? 'active' : ''}" data-nav="${n}">
            ${label} ${badge || ''}
          </button>`).join('')}
        <div class="nav-spacer"></div>
        <div class="nav-user">
          <div>${esc(State.user.name)}</div>
          <div class="role">${esc(State.user.role)}</div>
          <button class="nav-item" id="logout" style="margin-top:8px;padding-left:0">Sign out</button>
        </div>
        <div class="boran"><img src="/img/boran-coat.png" alt="Boran&amp;Co Group" /><span>Part of the<br><b>Boran&amp;Co Group</b></span></div>
        <div class="verline">Deal Control <b>v2.1</b> · <span id="buildstamp">…</span></div>
      </aside>
      <div class="main">
        <div class="topbar">
          <button class="btn sm menu-btn" id="menu">☰</button>
          <h1>${esc(title)}</h1>
          <div style="flex:1"></div>
          <div class="zoomctl" role="group" aria-label="Page zoom">
            <button type="button" id="zm-out" aria-label="Zoom out" title="Zoom out">−</button>
            <button type="button" id="zm-reset" aria-label="Reset zoom" title="Back to the standard size">${Math.round(getZoom() * 100)}%</button>
            <button type="button" id="zm-in" aria-label="Zoom in" title="Zoom in">+</button>
          </div>
          <button class="bell" id="bell" aria-label="Notifications">🔔<span class="bell-dot hidden" id="bell-dot"></span></button>
          ${actionsHtml}
        </div>
        <div class="content" id="content">${bodyHtml}</div>
      </div>
    </div>`;

  document.querySelectorAll('[data-nav]').forEach((b) => (b.onclick = () => go(b.dataset.nav)));
  document.getElementById('logout').onclick = async () => { await api('/logout', { method: 'POST' }); State.user = null; renderLogin(); };
  document.getElementById('bell').onclick = notificationsModal;
  document.getElementById('zm-out').onclick = () => stepZoom(-1);
  document.getElementById('zm-in').onclick = () => stepZoom(1);
  document.getElementById('zm-reset').onclick = () => setZoom(ZOOM_DEFAULT);
  applyZoom(getZoom());
  refreshBell();
  fetch('/version').then((r) => r.json()).then((j) => {
    const el = document.getElementById('buildstamp');
    if (el) el.textContent = 'build ' + String(j.build).slice(-6);
  }).catch(() => {});
  const sb = document.getElementById('sidebar'), scrim = document.getElementById('scrim');
  const openSb = () => { sb.classList.add('open'); scrim.classList.remove('hidden'); };
  const closeSb = () => { sb.classList.remove('open'); scrim.classList.add('hidden'); };
  document.getElementById('menu').onclick = openSb;
  scrim.onclick = closeSb;
}

/* ================= DASHBOARD ================= */
async function renderDeals() {
  let data;
  try { data = await api('/deals'); } catch (e) { return err(e.message); }
  if (isAdmin()) { try { State._pendingCount = (await api('/approvals')).length; } catch {} }
  const p = data.portfolio;
  State._dealList = data.deals;
  State._awaitingLetters = data.deals.filter((d) => d.closure_state === 'awaiting_letter').length;
  const activeDeals = byAdded(data.deals.filter((d) => d.status === 'active'));
  const cards = activeDeals.map(dealCard).join('');
  const actions = can('admin', 'office') ? `<button class="btn primary" id="newdeal">New deal</button>` : '';
  shell('Deals', `
    <div class="stats">
      <div class="stat"><div class="label">Active deals</div><div class="value">${p.activeDeals}</div></div>
      <div class="stat"><div class="label">Received of invoiced</div><div class="value green tnum">${money(p.totalReceived)}</div><div class="stat-sub">of ${money(p.totalInvoiced)}${p.totalInvoiced > 0 ? ' · ' + Math.round(p.totalReceived / p.totalInvoiced * 100) + '%' : ''}</div></div>
      <div class="stat"><div class="label">Still expecting to collect</div><div class="value tnum">${money(p.totalCustomerBalance)}</div></div>
      ${isAdmin()
        ? `<div class="stat"><div class="label">Our income kept</div><div class="value gold tnum">${money(p.totalIncomeKept)}</div><div class="stat-sub">of ${money(p.totalIncomeExpected)} expected</div></div>`
        : `<div class="stat"><div class="label">Unpaid for delivered goods</div><div class="value tnum">${money(p.totalUnderpaidToDate || 0)}</div></div>`}
    </div>
    ${State._awaitingLetters ? `<div class="alert warn letter-alert"><b>${State._awaitingLetters} completed ${State._awaitingLetters === 1 ? 'deal is' : 'deals are'} waiting for a manufacturer balance letter.</b> <a href="#" id="go-completed">Open Completed Deals →</a></div>` : ''}
    ${activeDeals.length > 1 ? listTools('q-deals') : ''}
    <div class="empty small hidden" id="q-deals-none">No deal matches that search.</div>
    ${activeDeals.length ? `<div class="dcard-grid">${cards}</div>` :
      `<div class="empty"><h3>No active deals</h3><p>${canWrite() ? 'Create your first deal to start tracking payments and deliveries.' : 'Deals will appear here once created.'}</p></div>`}
  `, actions);

  document.querySelectorAll('[data-deal]').forEach((c) => {
    c.onclick = () => go('deal', { id: Number(c.dataset.deal) });
    c.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); c.click(); } };
  });
  const nd = document.getElementById('newdeal');
  if (nd) nd.onclick = newDealModal;
  const gc = document.getElementById('go-completed');
  if (gc) gc.onclick = (e) => { e.preventDefault(); go('completed'); };
  wireCardEdits();
  wireDealSearch('q-deals', activeDeals);
  wireSortToggle();
}

function dealCard(d) {
  const c = d.computed, cur = d.currency, na = d.nextAction;
  const naClass = na.priority === 0 ? 'attn' : (na.code === 'complete_deal' ? 'done' : '');
  const invoice = Number(d.invoice_total) || 0;
  const paidOut = c.totalPaidToSupplier || 0;
  const recvPct = invoice > 0 ? Math.min(100, (c.totalReceived / invoice) * 100) : 0;
  const outPct = (Number(d.proforma_total) || 0) > 0 ? Math.min(100, (paidOut / Number(d.proforma_total)) * 100) : 0;
  const bar = (label, val, pctv, cls, sub) => `
    <div class="dc-bar">
      <div class="dc-bar-top"><span>${label}</span><b class="${cls}">${val}</b></div>
      <div class="progress ${cls}"><span style="width:${pctv}%"></span></div>
      <div class="meta">${sub}</div>
    </div>`;
  return `
    <div class="dcard" data-deal="${d.id}" tabindex="0" role="button" aria-label="Open deal ${esc(d.ref)}">
      <div class="dcard-top">
        <span class="dcard-ref">${esc(d.ref)}</span>
        <span class="dcard-top-r">
          <span class="pill ${d.status === 'active' ? 'blue' : d.status === 'completed' ? 'green' : 'gray'}">${esc(d.status)}</span>
          ${isAdmin() ? `<button class="card-edit" type="button" data-editdeal="${d.id}" aria-label="Edit details of ${esc(d.ref)}" title="Edit name, parties and invoice numbers">✎</button>` : ''}
        </span>
      </div>
      <div class="dcard-title">${esc(d.title)}</div>
      <div class="dcard-parties">${esc(d.customer_name)} <span>·</span> ${esc(d.supplier_name)}</div>
      ${invoiceNumbers(d)}
      <div class="dcard-figs">
        <div><span>Deal value</span><b>${money(invoice, cur)}</b></div>
        ${isAdmin()
          ? `<div class="gold"><span>Our income</span><b>${money(c.feeTotal, cur)}</b></div>`
          : `<div class="gold"><span>4% fee paid</span><b>${money(c.feePaid, cur)}</b></div>`}
      </div>
      <div class="dcard-bars">
        ${bar('Paid in', money(c.totalReceived, cur), recvPct, 'green', c.customerBalance > 0.005 ? `${money(c.customerBalance, cur)} still to collect` : 'fully collected')}
        ${bar('Paid out', money(paidOut, cur), outPct, 'blue', isAdmin() ? (c.supplierOpenToPay > 0.005 ? `${money(c.supplierOpenToPay, cur)} open to pay` : 'nothing open') : 'paid to the supplier')}
        ${bar('Delivered', pct(c.deliveryPct), Math.min(100, c.deliveryPct || 0), 'navy', `${money(c.deliveredValue, cur)} of ${money(c.deliveryTarget, cur)} proforma`)}
      </div>
      ${closureBadge(d, cur)}
      <div class="dcard-next ${naClass}"><span>Next</span> ${esc(na.label)}</div>
      ${isAdmin() && c.companyMoneyFronted > 0.005 ? `<span class="pill red" style="margin-top:8px">Fronted ${money(c.companyMoneyFronted, cur)}</span>` : ''}
    </div>`;
}

/* ================= NEW DEAL ================= */
function newDealModal() {
  const body = `
    <div class="steps">
      <div class="step"><span class="sn">1</span> Supplier proforma</div>
      <div class="step-arrow">→</div>
      <div class="step"><span class="sn">2</span> Our invoice (+ markup)</div>
      <div class="step-arrow">→</div>
      <div class="step"><span class="sn">3</span> Deal card</div>
    </div>
    <div class="form-row">
      <div class="field"><label>Deal reference</label><input id="f_ref" placeholder="e.g. EP-2026-014" /></div>
      <div class="field"><label>Currency</label>
        <select id="f_cur"><option>EUR</option><option>USD</option><option>GBP</option><option>RUB</option></select></div>
    </div>
    <div class="field"><label>Title</label><input id="f_title" placeholder="Short description of the deal" /></div>
    <div class="form-row">
      <div class="field"><label>Supplier proforma number</label><input id="f_pno" placeholder="as printed on the proforma" /></div>
      <div class="field"><label>Our invoice number to the client</label><input id="f_ino" placeholder="as printed on our invoice" /></div>
    </div>
    <div class="form-row">
      <div class="field"><label>Supplier (proforma from)</label><input id="f_supp" placeholder="e.g. Latvian supplier" /></div>
      <div class="field"><label>Client (we invoice)</label><input id="f_cust" /></div>
    </div>

    <div class="derive">
      <div class="derive-row">
        <div class="derive-item">
          <label>Supplier proforma amount</label>
          <input id="f_prof" inputmode="decimal" placeholder="96.155,00" />
        </div>
        <div class="derive-op">+</div>
        <div class="derive-item narrow">
          <label>Our markup %</label>
          <input id="f_rate" inputmode="decimal" value="4" />
        </div>
        <div class="derive-op">=</div>
        <div class="derive-item">
          <label>Our invoice to client</label>
          <input id="f_inv" inputmode="decimal" placeholder="auto" />
        </div>
      </div>
      <div class="derive-note" id="f_derive">Our invoice is derived from the supplier proforma. Enter the proforma to calculate it.</div>
    </div>

    <div class="section-title" style="margin:16px 0 8px">Invoice files — both are required</div>
    <div class="upload-req">
      <label class="ureq" id="u1lab"><span class="uicon">📄</span>
        <span class="utx"><b>Supplier proforma invoice</b><em id="u1name">No file chosen</em></span>
        <input type="file" id="f_file_prof" accept="application/pdf,image/png,image/jpeg" hidden /></label>
      <label class="ureq" id="u2lab"><span class="uicon">🧾</span>
        <span class="utx"><b>Our invoice to the client</b><em id="u2name">No file chosen</em></span>
        <input type="file" id="f_file_inv" accept="application/pdf,image/png,image/jpeg" hidden /></label>
    </div>
    <div id="nd_err" class="alert err hidden" style="margin-top:12px"></div>`;
  const footer = `<button class="btn" id="nd_cancel">Cancel</button><button class="btn primary" id="nd_save">Create deal</button>`;
  const close = openModal('New deal', body, footer, { wide: true });
  document.getElementById('nd_cancel').onclick = close;

  const prof = document.getElementById('f_prof'), rate = document.getElementById('f_rate'), inv = document.getElementById('f_inv');
  const note = document.getElementById('f_derive');
  let invTouched = false;
  inv.addEventListener('input', () => { invTouched = true; });
  const recalc = () => {
    const p = parseAmount(prof.value), r = parseAmount(rate.value);
    if (!Number.isFinite(p) || p <= 0) { note.textContent = 'Our invoice is derived from the supplier proforma. Enter the proforma to calculate it.'; return; }
    const pctv = Number.isFinite(r) ? r : 4;
    const calc = Math.round(p * (1 + pctv / 100) * 100) / 100;
    if (!invTouched) inv.value = calc;
    const shown = parseAmount(inv.value);
    const margin = Number.isFinite(shown) ? Math.round((shown - p) * 100) / 100 : calc - p;
    note.innerHTML = `Supplier proforma <b>${money(p)}</b> + ${pctv}% → our invoice <b>${money(Number.isFinite(shown) ? shown : calc)}</b> · our income <b class="gold">${money(margin)}</b>`;
  };
  prof.addEventListener('input', recalc); rate.addEventListener('input', recalc); inv.addEventListener('input', recalc);

  const bindFile = (inputId, labelId, nameId) => {
    const input = document.getElementById(inputId);
    input.addEventListener('change', () => {
      const f = input.files[0];
      document.getElementById(nameId).textContent = f ? f.name : 'No file chosen';
      document.getElementById(labelId).classList.toggle('ok', !!f);
    });
  };
  bindFile('f_file_prof', 'u1lab', 'u1name');
  bindFile('f_file_inv', 'u2lab', 'u2name');

  document.getElementById('nd_save').onclick = async () => {
    const fProf = document.getElementById('f_file_prof').files[0];
    const fInv = document.getElementById('f_file_inv').files[0];
    if (!fProf || !fInv) return showErr('nd_err', 'Both invoice files are required — attach the supplier proforma and our client invoice.');
    const payload = {
      ref: v('f_ref'), currency: v('f_cur'), title: v('f_title'),
      customer_name: v('f_cust'), supplier_name: v('f_supp'),
      proforma_total: v('f_prof'), invoice_total: v('f_inv'), commission_rate: v('f_rate'),
      proforma_number: v('f_pno'), invoice_number: v('f_ino'),
    };
    try {
      const r = await api('/deals', { method: 'POST', body: payload });
      const up = async (file, category) => {
        const fd = new FormData(); fd.append('file', file); fd.append('category', category);
        await api('/deals/' + r.id + '/documents', { method: 'POST', body: fd });
      };
      await up(fProf, 'Supplier proformas');
      await up(fInv, 'Customer invoices');
      close(); ok('Deal created with both invoices attached.'); go('deal', { id: r.id });
    } catch (e) { showErr('nd_err', e.message); }
  };
}
const v = (id) => document.getElementById(id).value.trim();
function showErr(id, msg) { const b = document.getElementById(id); b.textContent = msg; b.classList.remove('hidden'); }

/* ================= DEAL DETAIL ================= */
async function renderDeal() {
  let d;
  try { d = await api('/deals/' + State.route.id); } catch (e) { return err(e.message); }
  State.cache.deal = d;
  State.cache.docs = {}; (d.documents || []).forEach((x) => { State.cache.docs[x.id] = { mime: x.mime, name: x.original_name }; });
  const deal = d.deal, c = d.computed, cur = deal.currency, na = d.nextAction;
  const ro = deal.status !== 'active'; // read-only for entries
  State._dealCompleted = deal.status === 'completed';
  const naClass = na.priority === 0 ? 'attn' : (na.code === 'complete_deal' ? 'done' : '');

  const actions = `
    <button class="btn" id="back">← Deals</button>
    <button class="btn" id="to-flow">Flows</button>
    ${isAdmin() ? `<button class="btn" id="deal-report">Partner report</button>` : ''}
    ${isAdmin() && !['deleted', 'purged'].includes(deal.status) ? `<button class="btn" id="editdeal">Edit deal</button>` : ''}
    ${isAdmin() && deal.status === 'active' ? `<button class="btn primary" id="complete">Mark complete</button>` : ''}
    ${isAdmin() && deal.status === 'active' ? `<button class="btn" id="archive">Archive</button>` : ''}
    ${isAdmin() && deal.status === 'completed' ? `<button class="btn" id="reopen">Reopen</button>` : ''}`;

  const roBanner = ro && !deal.closure_state ? `<div class="alert info">This deal is <b>${esc(deal.status)}</b> and read-only.${isAdmin() && deal.status === 'completed' ? ' Reopen it to add activity.' : ''}</div>` : '';
  const pendBanner = d.pendingApprovals.length
    ? `<div class="alert warn">${d.pendingApprovals.length} submission(s) awaiting administrator approval — not yet in the ledger.</div>` : '';
  const fundBanner = c.supplierFundingShortfall > 0
    ? `<div class="alert err"><b>Funding difference.</b> Open supplier cost exceeds the reserve held by ${money(c.supplierFundingShortfall, cur)}. Forecast profit ${money(c.forecastProfit, cur)} vs 4% target ${money(c.targetProfit, cur)} (${money(c.profitVsTarget, cur)}).</div>` : '';

  const paidToSupplier = (c.supplierInvoicePaid || 0) + (c.supplierPrepaySent || 0);
  const supplierOwed = c.supplierOwed != null ? c.supplierOwed : (deal.proforma_total || 0);
  const recvPct = deal.invoice_total > 0 ? Math.min(100, c.totalReceived / deal.invoice_total * 100) : 0;
  const paidPct = supplierOwed > 0 ? Math.min(100, paidToSupplier / supplierOwed * 100) : 0;
  const incPct = c.incomeExpectedTotal > 0 ? Math.min(100, c.incomeKept / c.incomeExpectedTotal * 100) : 0;

  shell(deal.ref, `
    ${roBanner}${pendBanner}${isAdmin() ? fundBanner : ''}
    <div class="deal-head">
      <h2>${esc(deal.title)}</h2>
      <span class="pill ${deal.status === 'active' ? 'blue' : deal.status === 'completed' ? 'green' : 'gray'}">${esc(deal.status)}</span>
    </div>
    <div class="parties muted" style="margin-bottom:8px">${esc(deal.customer_name)} &nbsp;·&nbsp; ${esc(deal.supplier_name)}</div>
    ${invoiceNumbers(deal)}
    ${closurePanel(d)}
    ${!ro ? `<div class="nextline"><span class="nextline-k">Next:</span> ${esc(na.label)}</div>` : ''}

    <!-- THE DEAL AT A GLANCE: live diagram of both flows -->
    ${dealDiagram(d)}

    ${!ro && canWrite() ? `
    <div class="quick-actions">
      ${isAdmin() ? `<button class="btn primary big-btn" id="q-received">＋&nbsp; Money in from client</button>
      <button class="btn big-btn" id="q-paid">＋&nbsp; Money out to supplier</button>` : ''}
      <button class="btn ${isAdmin() ? '' : 'primary'} big-btn" id="q-delivery">＋&nbsp; Add a delivery</button>
    </div>
    ${isOffice() ? `<div class="meta" style="margin-top:8px">Payments are entered by Europa. Deliveries you add are sent for approval.</div>` : ''}` : ''}

    <!-- MONEY FLOW: payments in and out -->
    ${paymentsCard(d, cur, ro)}

    <!-- GOODS FLOW: deliveries against the proforma -->
    ${deliveryCard(d, cur)}
    ${goodsDiagram(d)}

    <!-- DOCUMENTS -->
    <div class="section-title" style="margin:24px 0 12px">Documents — tap a tile to upload</div>
    <div class="tiles">
      ${uploadTile(d, 'Supplier proforma', 'Supplier proformas', '📄', ro)}
      ${uploadTile(d, 'Our invoice to client', 'Customer invoices', '🧾', ro)}
      ${uploadTile(d, 'Delivery invoices', 'Delivery notes', '🚚', ro)}
    </div>

    <!-- OPTIONAL FULL DETAIL -->
    <button class="collapse-h details-main" id="details-toggle" style="margin-top:26px"><span class="chev">▶</span> Show full details &amp; history</button>
    <div id="details-body" class="hidden" style="margin-top:14px">
      ${sectionCloseout(c, cur, deal)}
      ${sectionDocuments(d, cur)}
      ${sectionAudit()}
    </div>
  `, actions);

  wireDeal(d);
  wireDiagram();
}

/* Upload tile: whole tile is one click to add a file; shows attached files. */
function uploadTile(d, title, category, icon, ro) {
  const files = d.documents.filter((x) => x.category === category);
  const has = files.length > 0;
  return `
    <div class="tile ${has ? 'has' : ''}">
      <div class="tile-icon">${icon}</div>
      <div class="tile-title">${esc(title)}</div>
      <div class="tile-status">${has ? `<span class="pill green">${files.length} file${files.length > 1 ? 's' : ''}</span>` : `<span class="pill gray">None yet</span>`}</div>
      ${files.length ? `<div class="tile-files">${files.slice(0, 4).map((f) => `<a href="#" data-preview="${f.id}">${esc(f.original_name)}</a>`).join('')}</div>` : ''}
      ${!ro && canWrite() ? `<button class="btn sm tile-btn" data-tileupload="${esc(category)}">${has ? 'Add another' : 'Upload'}</button>` : ''}
    </div>`;
}

function fig(k, val, cls = '', big = false) {
  return `<div class="fig"><div class="k">${esc(k)}</div><div class="v ${big ? 'big' : ''} ${cls} tnum">${val}</div></div>`;
}
function row(k, val, cls = '') { return `<div class="r"><div class="k">${esc(k)}</div><div class="v ${cls} tnum">${val}</div></div>`; }

function nextStepButton(na, deal) {
  const map = {
    customer_prepay: ['add-cust-pay', 'Record prepayment'],
    customer_payment: ['add-cust-pay', 'Record payment'],
    supplier_prepay: ['add-supp-prepay', 'Send prepayment'],
    pay_supplier: ['add-supp-pay', 'Pay invoice'],
    add_delivery: ['add-supp-inv', 'Add delivery'],
    resolve_funding: ['scroll-closeout', 'Review closeout'],
    complete_deal: isAdmin() ? ['complete', 'Mark complete'] : [null, ''],
  };
  const m = map[na.code];
  if (!m || !m[0]) return '';
  return `<button class="btn primary" data-next="${m[0]}">${m[1]}</button>`;
}

/* ---- Section 1: customer prepayment ---- */
function sectionCustomerPrepay(c, cur, ro) {
  if (c.custPrepayReq <= 0) return '';
  return card('Customer prepayment', `
    <div class="rowset">
      ${row('Required prepayment', money(c.custPrepayReq, cur))}
      ${row('Received prepayment', money(c.prepayReceived, cur), 'green')}
      ${row('Remaining prepayment', money(c.prepayRemaining, cur), c.prepayRemaining > 0 ? 'amber' : 'green')}
      ${c.prepayAbovePlan > 0 ? row('Received above planned prepayment', money(c.prepayAbovePlan, cur), 'amber') : ''}
    </div>`,
    !ro && canWrite() ? `<button class="btn sm primary" data-next="add-cust-pay">Record prepayment</button>` : '');
}

/* ---- Section 2: supplier prepayment ---- */
function sectionSupplierPrepay() { return ''; /* replaced by the payment layer + proforma model */ }

/* ---- Section 3: customer payment journey ---- */
function sectionCustomerJourney(d, cur, ro) {
  const rows = d.customerPayments.filter((p) => p.status !== 'void');
  const voids = d.customerPayments.filter((p) => p.status === 'void');
  const list = rows.length ? rows.map((p) => custRow(p, cur, d)).join('') :
    `<div class="empty small">No customer receipts recorded yet.</div>`;
  const voidBlock = voids.length ? collapsible('cust-void', `Voided receipts (${voids.length})`, voids.map((p) => custRow(p, cur, d)).join('')) : '';
  const addBtn = !ro && canWrite() ? `<button class="btn sm primary" data-next="add-cust-pay">Record payment</button>` : '';
  return card('Customer payment journey', `<div class="journey">${list}</div>${voidBlock}`, addBtn);
}
function custRow(p, cur, d) {
  const pend = p.status === 'pending';
  const proof = docFor(d, 'customer_payment', p.id);
  return `
    <div class="jrow ${p.status === 'void' ? 'void' : ''}">
      <div class="jrow-top">
        <div><b>${fdate(p.date)}</b> · <span class="tag">${esc(p.ptype)}${p.is_prepayment ? ' · prepayment' : ''}</span>
          ${pend ? '<span class="pill amber">Awaiting approval</span>' : ''}
          ${p.status === 'void' ? `<span class="pill red">Void</span>` : ''}</div>
        <div>
          ${proof ? `<span class="pill green">Proof attached</span>` : `<span class="pill gray">No proof</span>`}
          ${canWrite() && p.status !== 'void' ? `<button class="btn sm" data-upload='${uploadAttr('customer_payment', p.id)}'>Upload proof</button>` : ''}
          ${isAdmin() && p.status === 'posted' ? `<button class="btn sm danger" data-void='customer_payment:${p.id}'>Void</button>` : ''}
        </div>
      </div>
      <div class="jrow-figs">
        <div><div class="k">Money received</div><div class="v tnum">${money(p.amount_received, cur)}</div></div>
        <div><div class="k">Applied to deal</div><div class="v tnum">${money(p.amount_applied, cur)}</div></div>
        ${isAdmin() ? `
        <div><div class="k">Our income</div><div class="v tnum gold">${money(p.kept, cur)}</div></div>
        <div><div class="k">For supplier</div><div class="v tnum">${money(p.reserved, cur)}</div></div>` : ''}
        ${p.overpayment > 0 ? `<div><div class="k">Overpayment</div><div class="v tnum">${money(p.overpayment, cur)}</div></div>` : ''}
      </div>
      ${p.void_reason ? `<div class="meta" style="margin-top:8px">Void reason: ${esc(p.void_reason)}</div>` : ''}
      ${p.bank_ref || p.notes ? `<div class="meta" style="margin-top:8px">${p.bank_ref ? 'Ref: ' + esc(p.bank_ref) + '  ' : ''}${p.notes ? esc(p.notes) : ''}</div>` : ''}
    </div>`;
}

/* ---- deliveries list (used inside the delivery card) ---- */
function deliveriesTable(d, cur) {
  const invs = d.supplierInvoices.filter((i) => i.status !== 'void');
  if (!invs.length) return `<div class="empty small">No deliveries yet. The supplier ships in batches as goods are produced.</div>`;
  return `
    <table class="grid">
      <thead><tr><th>Delivery invoice</th><th>Date</th><th class="num">Proforma value delivered</th><th>Qty</th><th></th></tr></thead>
      <tbody>
      ${invs.map((i) => {
        const proof = docFor(d, 'supplier_invoice', i.id);
        return `<tr>
          <td data-label="Delivery invoice">${esc(i.invoice_number)} ${i.status === 'pending' ? '<span class="pill amber">awaiting approval</span>' : ''}
            ${proof ? `<a href="#" data-preview="${proof.id}" class="pill green">view file</a>` : ''}</td>
          <td data-label="Date">${fdate(i.delivery_date || i.issue_date)}</td>
          <td class="num" data-label="Proforma value">${money(i.proforma_allocated || 0, cur)}</td>
          <td data-label="Qty">${esc(i.quantity || '—')}</td>
          <td class="num" data-label="">${deliveryActions(d, i)}</td>
        </tr>`;
      }).join('')}
      </tbody>
    </table>`;
}
/* Fix (✎) and Void for a delivery row. Admins change it directly; anyone else
   sends a request that waits for an administrator's approval. */
function deliveryActions(d, i) {
  if (i.status !== 'posted' || !canWrite() || d.deal.status !== 'active') return '';
  const pending = (d.pendingApprovals || []).find((a) => a.entity_type === 'supplier_invoice' && a.entity_id === i.id && (a.action === 'edit' || a.action === 'void'));
  if (pending) return `<span class="pill amber">${pending.action === 'void' ? 'void' : 'fix'} awaiting approval</span>`;
  return `<button class="btn sm icon-btn" data-dfix="${i.id}" aria-label="Fix delivery ${esc(i.invoice_number)}" title="Fix this delivery">✎ Fix</button>
    <button class="btn sm danger" data-dvoid="${i.id}" aria-label="Void delivery ${esc(i.invoice_number)}">Void</button>`;
}
function deliveryFixModal(d, id) {
  const i = d.supplierInvoices.find((x) => x.id === id);
  if (!i) return;
  const cur = d.deal.currency;
  const body = `
    ${isAdmin() ? '' : '<div class="alert info">Your correction will be sent to Europa for approval. Nothing changes until it is approved.</div>'}
    <div class="form-row">
      <div class="field"><label>Delivery invoice number</label><input id="fx_num" value="${esc(i.invoice_number)}" /></div>
      <div class="field"><label>Delivery date</label><input id="fx_date" type="date" value="${esc((i.delivery_date || i.issue_date || '').slice(0, 10))}" /></div>
    </div>
    <div class="form-row">
      <div class="field"><label>Proforma value delivered</label><input id="fx_amt" inputmode="decimal" value="${Number(i.proforma_allocated) || ''}" />
        <div class="hint">Currently ${money(i.proforma_allocated || 0, cur)}</div></div>
      <div class="field"><label>Quantity (optional)</label><input id="fx_qty" value="${esc(i.quantity || '')}" /></div>
    </div>
    <div class="field"><label>Notes</label><textarea id="fx_notes">${esc(i.notes || '')}</textarea></div>
    <div id="fx_err" class="alert err hidden"></div>`;
  const close = openModal('Fix delivery ' + i.invoice_number, body,
    `<button class="btn" id="fx_no">Cancel</button><button class="btn primary" id="fx_yes">${isAdmin() ? 'Save correction' : 'Send for approval'}</button>`);
  document.getElementById('fx_no').onclick = close;
  document.getElementById('fx_yes').onclick = async () => {
    const payload = { invoice_number: v('fx_num'), delivery_date: v('fx_date'), amount: v('fx_amt'), quantity: v('fx_qty'), notes: document.getElementById('fx_notes').value.trim() };
    try {
      const r = await api('/deliveries/' + id, { method: 'PATCH', body: payload });
      close(); ok(r.status === 'pending' ? 'Correction sent for approval.' : 'Delivery corrected.'); rerenderCurrent();
    } catch (e) { showErr('fx_err', e.message); }
  };
}
function deliveryVoidModal(d, id) {
  const i = d.supplierInvoices.find((x) => x.id === id);
  if (!i) return;
  const body = `<p>Void delivery <b>${esc(i.invoice_number)}</b> (${money(i.proforma_allocated || 0, d.deal.currency)})? It stays in the history but no longer counts towards delivered goods.</p>
    ${isAdmin() ? '' : '<div class="alert info">This will be sent to Europa for approval.</div>'}
    <div class="field"><label>Reason (required)</label><textarea id="dv_reason" placeholder="e.g. entered twice, wrong deal"></textarea></div>
    <div id="dv_err" class="alert err hidden"></div>`;
  const close = openModal('Void delivery', body,
    `<button class="btn" id="dv_no">Cancel</button><button class="btn danger" id="dv_yes">${isAdmin() ? 'Void delivery' : 'Request void'}</button>`);
  document.getElementById('dv_no').onclick = close;
  document.getElementById('dv_yes').onclick = async () => {
    try {
      const r = await api('/deliveries/' + id + '/void', { method: 'POST', body: { reason: v('dv_reason') } });
      close(); ok(r.status === 'pending' ? 'Void request sent for approval.' : 'Delivery voided.'); rerenderCurrent();
    } catch (e) { showErr('dv_err', e.message); }
  };
}
function wireDeliveryButtons(d) {
  document.querySelectorAll('[data-dfix]').forEach((b) => (b.onclick = () => deliveryFixModal(d, Number(b.dataset.dfix))));
  document.querySelectorAll('[data-dvoid]').forEach((b) => (b.onclick = () => deliveryVoidModal(d, Number(b.dataset.dvoid))));
}
/* Re-render whichever deal view is open (full deal page or the flow view). */
function rerenderCurrent() { return State.route.name === 'flow' ? renderFlow() : renderDeal(); }

function sectionSupplierInvoices() { return ''; /* deliveries now shown in their own card */ }

/* =====================================================================
   DEAL DIAGRAM — live picture of the two independent flows on one deal.
     Money (top):  Client ──pays──▶ Europa ──pays──▶ Supplier
     Goods (bottom): Supplier ──ships in batches──▶ Client  (no money effect)
   Every box, arrow and bar carries a data-dtip explanation shown on hover/tap.
   ===================================================================== */
function dealDiagram(d) {
  const deal = d.deal, c = d.computed, cur = deal.currency, admin = isAdmin();
  const m = (v) => money(v, cur);
  const posted = (arr) => (arr || []).filter((x) => x.status === 'posted');
  const ins = posted(d.customerPayments), outs = posted(d.supplierPayments), dels = posted(d.supplierInvoices);
  const paidOut = outs.reduce((a, p) => a + Number(p.amount || 0), 0);
  const invoice = Number(deal.invoice_total) || 0;
  const proforma = Number(deal.proforma_total) || 0;
  const fee = c.feeTotal || 0;
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  const listTip = (rows, fmt) => rows.slice(-5).map(fmt).join('\n') + (rows.length > 5 ? `\n… and ${rows.length - 5} earlier` : '');

  const F = {
    moneyPct: invoice > 0 ? Math.min(100, (c.totalReceived / invoice) * 100) : 0,
    goodsPct: Math.min(100, c.deliveryPct || 0),
    invoice, proforma, fee, paidOut, m,
    delivered: c.deliveredValue || 0, remaining: c.deliveryOutstanding || 0, dels,
    inCount: plural(ins.length, 'payment'), outCount: plural(outs.length, 'payment'),
    delCount: plural(dels.length, 'delivery').replace('deliverys', 'deliveries'),
    inAmt: m(c.totalReceived), outAmt: m(paidOut),
    tipIn: ins.length
      ? `Payments in from ${deal.customer_name}: ${m(c.totalReceived)}\n` + listTip(ins, (p) => `${fdate(p.date)}  ${m(p.amount_received)}`)
      : `No payments received from ${deal.customer_name} yet.`,
    tipOut: outs.length
      ? `Payments out to ${deal.supplier_name}: ${m(paidOut)}\n` + listTip(outs, (p) => `${fdate(p.date)}  ${m(p.amount)}`)
      : `Nothing paid to ${deal.supplier_name} yet.`,
    tipGoods: dels.length
      ? `Goods shipped directly from ${deal.supplier_name} to ${deal.customer_name}.\n` + listTip(dels, (x) => `${x.invoice_number} · ${fdate(x.delivery_date || x.issue_date)} · ${m(x.proforma_allocated || 0)}`)
      : `No deliveries yet. The supplier ships in batches as goods are produced.`,
    tipMoneyPool: `Deal pool = our invoice ${m(invoice)}` + (admin ? `\n= supplier proforma ${m(proforma)} + our income ${m(fee)}` : `\n(includes the agreed 4% fee of ${m(fee)})`) +
      `\nPaid in so far ${m(c.totalReceived)} · still to pay ${m(c.customerBalance)}`,
    tipGoodsPool: `Proforma pool ${m(proforma)} — the goods the supplier committed to deliver.\nDelivered ${m(c.deliveredValue)} · still to deliver ${m(c.deliveryOutstanding)}.\nDeliveries never change any payment.`,
  };

  const nodes = {
    client: {
      role: 'Client · pays us', name: deal.customer_name, icon: '🏢', accent: 'green',
      tip: `${deal.customer_name}\nInvoiced ${m(invoice)} (supplier proforma + our 4%).\nPaid so far ${m(c.totalReceived)} in ${F.inCount}.\nStill to pay ${m(c.customerBalance)}.`,
      lines: [['Invoiced', m(invoice), ''], ['Paid', m(c.totalReceived), 'green'],
        ['Still to pay', m(c.customerBalance), c.customerBalance > 0.005 ? 'amber' : 'green']],
    },
    europa: admin ? {
      role: 'Europa · us', name: 'Europa Pharmaceutical', logo: true, accent: 'gold',
      tip: `Cash held now ${m(c.heldInHouse)} = received ${m(c.totalReceived)} − paid out ${m(paidOut)}.\nOur income on this deal ${m(fee)}: ${m(c.incomeKept)} earned, ${m(c.incomeRemaining)} still to come.`,
      lines: [['Cash held now', m(c.heldInHouse), ''], ['Income earned', m(c.incomeKept), 'gold'],
        ['Income to come', m(c.incomeRemaining), c.incomeRemaining > 0.005 ? 'amber' : 'green']],
    } : {
      role: 'Europa · 4% fee', name: 'Europa Pharmaceutical', logo: true, accent: 'gold',
      tip: `Your invoice includes our agreed 4% fee of ${m(fee)}.\nEvery payment covers a proportional share of it: ${m(c.feePaid)} covered so far, ${m(c.feeRemaining)} remaining.`,
      lines: [['4% fee total', m(fee), ''], ['Fee paid', m(c.feePaid), 'gold'],
        ['Fee remaining', m(c.feeRemaining), c.feeRemaining > 0.005 ? 'amber' : 'green']],
    },
    supplier: {
      role: 'Supplier · paid by us', name: deal.supplier_name, icon: '🏭', accent: 'navy',
      tip: `${deal.supplier_name}\nProforma ${m(proforma)} sets the deal.\nPaid so far ${m(paidOut)} in ${F.outCount}.\nDelivered ${m(c.deliveredValue)} of the proforma in ${F.delCount}.`,
      lines: admin
        ? [['Proforma', m(proforma), ''], ['Paid', m(paidOut), 'navy'],
          ['Open to pay', m(c.supplierOpenToPay), c.supplierOpenToPay > 0.005 ? 'amber' : 'green']]
        : [['Proforma', m(proforma), ''], ['Paid', m(paidOut), 'navy'], ['Delivered', m(c.deliveredValue), 'green']],
    },
  };

  // How the deal is built — the proforma is the starting point.
  const build = admin
    ? `<div class="dg-build">
        <span class="bchip" data-dtip="${esc('The supplier proforma sets the scope of the deal: ' + m(proforma) + '.')}">Supplier proforma <b>${m(proforma)}</b></span>
        <span class="bop">+</span>
        <span class="bchip gold" data-dtip="${esc('Our markup on top of the proforma (' + (c.marginPct || 0) + '%). This is our income on the deal.')}">Our income <b>${m(fee)}</b></span>
        <span class="bop">=</span>
        <span class="bchip navy" data-dtip="${esc('What we invoice the client: the proforma plus our income.')}">Invoice to client <b>${m(invoice)}</b></span>
      </div>`
    : `<div class="dg-build">
        <span class="bchip navy" data-dtip="${esc('Your order value, as invoiced by Europa.')}">Order value <b>${m(invoice)}</b></span>
        <span class="bop">=</span>
        <span class="bchip" data-dtip="${esc('The supplier proforma — the goods to be produced and delivered.')}">Supplier proforma <b>${m(proforma)}</b></span>
        <span class="bop">+</span>
        <span class="bchip gold" data-dtip="${esc('The agreed 4% fee included in your invoice.')}">Agreed 4% fee <b>${m(fee)}</b></span>
      </div>`;

  return `
    <div class="card dg-card">
      <div class="card-h"><h3>Deal at a glance</h3><div style="flex:1"></div><span class="meta">Hover or tap any box, arrow or bar for details</span></div>
      <div class="card-b">
        ${build}
        ${dgSvgWide(nodes, F)}
        ${dgSvgTall(nodes, F)}
        <div class="dg-legend">
          <span><i class="lg money"></i> Money flow — payments in and out</span>
          <span><i class="lg goods"></i> Goods flow — deliveries, no effect on money</span>
        </div>
      </div>
    </div>`;
}

/* ---- diagram drawing helpers ---- */
function dgDefs(id) {
  return `<defs>
    <marker id="${id}-am" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="dg-ah-money"/></marker>
    <marker id="${id}-ag" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="dg-ah-goods"/></marker>
  </defs>`;
}
function dgIcon(kind, x, y) {
  // Small drawn badges so icons render identically on every system.
  const g = (inner, cls) => `<g transform="translate(${x},${y})"><rect width="30" height="30" rx="8" class="dg-badge ${cls}"/>${inner}</g>`;
  if (kind === 'client') return g('<rect x="7" y="11" width="16" height="11" rx="2" class="dg-glyph"/><path d="M12 11V9.2a1.4 1.4 0 0 1 1.4-1.4h3.2A1.4 1.4 0 0 1 18 9.2V11" class="dg-glyph-line"/><path d="M7 15.5h16" class="dg-glyph-line"/>', 'b-green');
  return g('<path d="M6 23V13l5 3v-3l5 3V8h3.2l1.3 15z" class="dg-glyph"/>', 'b-navy');
}
function dgNode(n, x, y, w, h) {
  // Fit the company name to the box: shrink the font first, truncate only if very long.
  const avail = w - 16 - 54;
  const maxChars = Math.floor(avail / (14 * 0.55));
  const nm = n.name.length > maxChars ? n.name.slice(0, maxChars - 1) + '…' : n.name;
  const fs = Math.max(14, Math.min(19, avail / (Math.max(1, nm.length) * 0.55)));
  const badge = n.logo
    ? `<image href="/img/europa-icon.png" x="${x + w - 46}" y="${y + 14}" width="30" height="30"/>`
    : dgIcon(n.accent === 'green' ? 'client' : 'supplier', x + w - 46, y + 14);
  const lines = n.lines.map((l, i) => {
    const ly = y + 94 + i * 27;
    return `<text x="${x + 16}" y="${ly}" class="dg-k">${esc(l[0])}</text>` +
      `<text x="${x + w - 16}" y="${ly}" text-anchor="end" class="dg-v ${l[2]}">${esc(l[1])}</text>`;
  }).join('');
  return `<g class="dg-node dg-${n.accent}" tabindex="0" data-dtip="${esc(n.tip)}">
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="16" class="dg-box"/>
    <text x="${x + 16}" y="${y + 30}" class="dg-role">${esc(n.role.toUpperCase())}</text>
    <text x="${x + 16}" y="${y + 55}" class="dg-name" style="font-size:${fs.toFixed(1)}px">${esc(nm)}</text>
    ${badge}
    <line x1="${x + 16}" y1="${y + 70}" x2="${x + w - 16}" y2="${y + 70}" class="dg-rule"/>
    ${lines}
  </g>`;
}
function dgPool(id, x, y, w, h, pct, cls, tip) {
  const fw = Math.max(0, Math.min(w, (w * pct) / 100));
  return `<g tabindex="0" data-dtip="${esc(tip)}" class="dg-pool">
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" class="dg-track"/>
    ${fw > 0 ? `<rect x="${x}" y="${y}" width="${fw}" height="${h}" rx="${h / 2}" class="dg-fill ${cls}"/>` : ''}
  </g>`;
}
/* goods pool: one segment per delivery, each with its own tooltip */
function dgGoodsPool(id, x, y, w, h, F) {
  const total = F.proforma || 1;
  let cx = x;
  const segs = F.dels.map((dl, i) => {
    const val = Number(dl.proforma_allocated) || 0;
    const sw = Math.max(0, Math.min(x + w - cx, (w * val) / total));
    const seg = sw > 0 ? `<rect x="${cx}" y="${y}" width="${sw}" height="${h}" class="dg-seg s${i % 2}"
        tabindex="0" data-dtip="${esc(`Delivery ${dl.invoice_number}\n${fdate(dl.delivery_date || dl.issue_date)} · ${F.m(val)} (proforma value)`)}"/>` : '';
    cx += sw;
    return seg;
  }).join('');
  return `<defs><clipPath id="${id}-gc"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}"/></clipPath></defs>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" class="dg-track" tabindex="0" data-dtip="${esc(F.tipGoodsPool)}"/>
    <g clip-path="url(#${id}-gc)">${segs}</g>`;
}

function dgSvgWide(N, F) {
  const id = 'dgw';
  return `<svg class="dg-svg dg-wide" viewBox="0 0 1000 468" role="img" aria-label="Deal diagram: money and goods flows">
    ${dgDefs(id)}
    <text x="20" y="22" class="dg-lane">MONEY FLOW</text>
    <text x="980" y="22" text-anchor="end" class="dg-lane-r">Deal pool ${esc(F.m(F.invoice))} · ${Math.round(F.moneyPct)}% paid in</text>
    ${dgPool(id, 20, 32, 960, 12, F.moneyPct, 'money', F.tipMoneyPool)}

    ${dgNode(N.client, 20, 78, 240, 176)}
    ${dgNode(N.europa, 380, 78, 240, 176)}
    ${dgNode(N.supplier, 740, 78, 240, 176)}

    <g tabindex="0" data-dtip="${esc(F.tipIn)}" class="dg-flow">
      <rect x="262" y="136" width="116" height="84" class="dg-hit"/>
      <text x="320" y="152" text-anchor="middle" class="dg-flabel">PAID IN</text>
      <path d="M266,168 H372" class="dg-money" marker-end="url(#${id}-am)"/>
      <text x="320" y="192" text-anchor="middle" class="dg-famt green">${esc(F.inAmt)}</text>
      <text x="320" y="210" text-anchor="middle" class="dg-fsub">${esc(F.inCount)}</text>
    </g>
    <g tabindex="0" data-dtip="${esc(F.tipOut)}" class="dg-flow">
      <rect x="622" y="136" width="116" height="84" class="dg-hit"/>
      <text x="680" y="152" text-anchor="middle" class="dg-flabel">PAID OUT</text>
      <path d="M626,168 H732" class="dg-money" marker-end="url(#${id}-am)"/>
      <text x="680" y="192" text-anchor="middle" class="dg-famt navy">${esc(F.outAmt)}</text>
      <text x="680" y="210" text-anchor="middle" class="dg-fsub">${esc(F.outCount)}</text>
    </g>

    <g tabindex="0" data-dtip="${esc(F.tipGoods)}" class="dg-flow">
      <rect x="120" y="258" width="780" height="100" class="dg-hit"/>
      <path d="M860,258 V328 H140 V262" class="dg-goods" marker-end="url(#${id}-ag)"/>
      <text x="500" y="318" text-anchor="middle" class="dg-flabel goods">GOODS DELIVERED · ${esc(F.delCount.toUpperCase())}</text>
      <text x="500" y="352" text-anchor="middle" class="dg-famt goods">${esc(F.m(F.delivered))}</text>
    </g>

    <text x="20" y="400" class="dg-lane goods">GOODS FLOW · does not affect money</text>
    <text x="980" y="400" text-anchor="end" class="dg-lane-r">Proforma pool ${esc(F.m(F.proforma))} · ${Math.round(F.goodsPct)}% delivered</text>
    ${dgGoodsPool(id, 20, 410, 960, 16, F)}
    <text x="20" y="452" class="dg-k">Delivered ${esc(F.m(F.delivered))}</text>
    <text x="980" y="452" text-anchor="end" class="dg-k">Still to deliver ${esc(F.m(F.remaining))}</text>
  </svg>`;
}

function dgSvgTall(N, F) {
  const id = 'dgt';
  return `<svg class="dg-svg dg-tall" viewBox="0 0 400 930" role="img" aria-label="Deal diagram: money and goods flows">
    ${dgDefs(id)}
    <text x="20" y="22" class="dg-lane">MONEY FLOW</text>
    <text x="20" y="42" class="dg-lane-r">Deal pool ${esc(F.m(F.invoice))} · ${Math.round(F.moneyPct)}% paid in</text>
    ${dgPool(id, 20, 52, 360, 12, F.moneyPct, 'money', F.tipMoneyPool)}

    ${dgNode(N.client, 20, 84, 300, 176)}
    <g tabindex="0" data-dtip="${esc(F.tipIn)}" class="dg-flow">
      <rect x="120" y="262" width="200" height="86" class="dg-hit"/>
      <path d="M150,264 V344" class="dg-money" marker-end="url(#${id}-am)"/>
      <text x="168" y="290" class="dg-flabel">PAID IN</text>
      <text x="168" y="314" class="dg-famt green">${esc(F.inAmt)}</text>
      <text x="168" y="332" class="dg-fsub">${esc(F.inCount)}</text>
    </g>
    ${dgNode(N.europa, 20, 350, 300, 176)}
    <g tabindex="0" data-dtip="${esc(F.tipOut)}" class="dg-flow">
      <rect x="120" y="528" width="200" height="86" class="dg-hit"/>
      <path d="M150,530 V610" class="dg-money" marker-end="url(#${id}-am)"/>
      <text x="168" y="556" class="dg-flabel">PAID OUT</text>
      <text x="168" y="580" class="dg-famt navy">${esc(F.outAmt)}</text>
      <text x="168" y="598" class="dg-fsub">${esc(F.outCount)}</text>
    </g>
    ${dgNode(N.supplier, 20, 616, 300, 176)}

    <g tabindex="0" data-dtip="${esc(F.tipGoods)}" class="dg-flow">
      <rect x="322" y="160" width="76" height="560" class="dg-hit"/>
      <path d="M324,704 H356 V172 H328" class="dg-goods" marker-end="url(#${id}-ag)"/>
      <text transform="rotate(-90 388 438)" x="388" y="438" text-anchor="middle" class="dg-flabel goods">GOODS · ${esc(F.m(F.delivered))}</text>
    </g>

    <text x="20" y="836" class="dg-lane goods">GOODS FLOW · no effect on money</text>
    <text x="20" y="856" class="dg-lane-r">Proforma pool ${esc(F.m(F.proforma))} · ${Math.round(F.goodsPct)}% delivered</text>
    ${dgGoodsPool(id, 20, 866, 360, 16, F)}
    <text x="20" y="908" class="dg-k">Delivered ${esc(F.m(F.delivered))}</text>
    <text x="380" y="908" text-anchor="end" class="dg-k">To deliver ${esc(F.m(F.remaining))}</text>
  </svg>`;
}

/* Floating tooltip for diagrams: hover (desktop), focus (keyboard), tap (touch).
   One shared tooltip element lives on <body>, so any number of diagrams can use it. */
function dgTipEl() {
  let t = document.getElementById('dg-tip');
  if (!t) {
    t = document.createElement('div');
    t.id = 'dg-tip'; t.className = 'dg-tip'; t.setAttribute('role', 'tooltip');
    document.body.appendChild(t);
  }
  return t;
}
function wireDiagram() {
  const tip = dgTipEl();
  tip.classList.remove('on');
  let pinned = null;
  const place = (x, y) => {
    const pad = 12, tw = tip.offsetWidth, th = tip.offsetHeight;
    let left = x + 14, top = y + 16;
    if (left + tw > window.innerWidth - pad) left = Math.max(pad, x - tw - 14);
    if (top + th > window.innerHeight - pad) top = Math.max(pad, y - th - 14);
    tip.style.left = left + 'px'; tip.style.top = top + 'px';
  };
  const show = (el, x, y) => { tip.textContent = el.getAttribute('data-dtip'); tip.classList.add('on'); place(x, y); };
  const hide = () => { tip.classList.remove('on'); pinned = null; };
  const centre = (el) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
  document.querySelectorAll('.dg-card [data-dtip]').forEach((el) => {
    el.addEventListener('mouseenter', (e) => { if (!pinned) show(el, e.clientX, e.clientY); });
    el.addEventListener('mousemove', (e) => { if (!pinned) place(e.clientX, e.clientY); });
    el.addEventListener('mouseleave', () => { if (!pinned) hide(); });
    el.addEventListener('focus', () => { const [x, y] = centre(el); show(el, x, y); });
    el.addEventListener('blur', () => { if (!pinned) hide(); });
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (pinned === el) return hide();
      pinned = el; const [x, y] = centre(el); show(el, x, y);
    });
  });
  if (!State._tipGlobal) {   // register the page-wide close handlers only once
    State._tipGlobal = true;
    document.addEventListener('click', () => dgTipEl().classList.remove('on'));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') dgTipEl().classList.remove('on'); });
  }
}

/* =====================================================================
   GOODS FLOW DIAGRAM — the supplier ships the proforma in batches.
   Shows each delivery on a timeline, and checks delivered value against
   what has been paid: goods can arrive before they are paid for (we then
   owe the supplier), or be paid for before they arrive (we wait for goods).
   ===================================================================== */
function goodsDiagram(d) {
  const deal = d.deal, c = d.computed, cur = deal.currency;
  const m = (v) => money(v, cur);
  const posted = (arr) => (arr || []).filter((x) => x.status === 'posted');
  const dels = posted(d.supplierInvoices).slice().sort((a, b) => String(a.delivery_date || a.issue_date || '').localeCompare(String(b.delivery_date || b.issue_date || '')) || a.id - b.id);
  const paidOut = posted(d.supplierPayments).reduce((a, p) => a + Number(p.amount || 0), 0);
  const proforma = Number(deal.proforma_total) || 0;
  const invoice = Number(deal.invoice_total) || 0;
  const delivered = c.deliveredValue || 0;
  const deliveredClient = c.deliveredClient || 0;

  // Supplier check: delivered (proforma value) vs paid to the supplier.
  const supGap = Math.round((delivered - paidOut) * 100) / 100;
  const sup = supGap > 0.005
    ? { cls: 'amber', text: `Delivered, not yet paid ${m(supGap)}`, tip: `Goods worth ${m(delivered)} have been delivered, but only ${m(paidOut)} has been paid to the supplier.\n${m(supGap)} of delivered goods is still unpaid — a payment to the supplier is due.` }
    : supGap < -0.005
      ? { cls: 'blue', text: `Paid ahead, awaiting goods ${m(-supGap)}`, tip: `${m(paidOut)} has been paid to the supplier, but goods worth only ${m(delivered)} have been delivered.\n${m(-supGap)} is paid in advance and waiting to be delivered.` }
      : { cls: 'green', text: 'Delivered and paid are in balance', tip: `Delivered ${m(delivered)} · paid to supplier ${m(paidOut)}.` };
  // Client check: goods received (at invoice value) vs paid by the client.
  const cliGap = Math.round((deliveredClient - c.totalReceived) * 100) / 100;
  const cli = cliGap > 0.005
    ? { cls: 'amber', text: `Client owes for delivered goods ${m(cliGap)}`, tip: `The client has received goods worth ${m(deliveredClient)} at invoice prices, but has paid ${m(c.totalReceived)}.\n${m(cliGap)} is owed for goods already delivered.` }
    : cliGap < -0.005
      ? { cls: 'blue', text: `Client paid ahead of delivery ${m(-cliGap)}`, tip: `The client has paid ${m(c.totalReceived)}, ahead of goods delivered worth ${m(deliveredClient)} at invoice prices.` }
      : { cls: 'green', text: 'Client payments match deliveries', tip: `Goods delivered ${m(deliveredClient)} at invoice prices · paid ${m(c.totalReceived)}.` };

  const G = {
    m, cur, dels, proforma, invoice, delivered, deliveredClient, paidOut, received: c.totalReceived,
    remaining: c.deliveryOutstanding || 0, pct: Math.min(100, c.deliveryPct || 0), sup, cli,
    tipGoodsPool: `Proforma pool ${m(proforma)} — what the supplier committed to deliver.\nDelivered ${m(delivered)} · still to deliver ${m(c.deliveryOutstanding)}.`,
    supNode: {
      role: 'Supplier · ships goods', name: deal.supplier_name, accent: 'navy',
      tip: `${deal.supplier_name} ships the proforma (${m(proforma)}) in batches as goods are produced.\nDelivered ${m(delivered)} so far, ${m(c.deliveryOutstanding)} still to deliver.`,
      lines: [['Proforma', m(proforma), ''], ['Delivered', m(delivered), 'navy'],
        ['Still to deliver', m(c.deliveryOutstanding), c.deliveryOutstanding > 0.005 ? 'amber' : 'green']],
    },
    cliNode: {
      role: 'Client · receives goods', name: deal.customer_name, accent: 'green',
      tip: `${deal.customer_name} receives goods directly from the supplier.\nGoods received are worth ${m(deliveredClient)} at invoice prices; the client has paid ${m(c.totalReceived)}.`,
      lines: [['Goods received', m(deliveredClient), 'navy'], ['Paid by client', m(c.totalReceived), 'green'],
        cliGap > 0.005 ? ['Owes for goods', m(cliGap), 'amber'] : ['Paid ahead', m(Math.max(0, -cliGap)), 'green']],
    },
  };
  return `
    <div class="card dg-card">
      <div class="card-h"><h3>Goods flow</h3><div style="flex:1"></div><span class="meta">Deliveries against the proforma · hover or tap for details</span></div>
      <div class="card-b">
        ${gdSvgWide(G)}
        ${gdSvgTall(G)}
        <div class="dg-legend">
          <span><i class="lg goods"></i> Delivery (proforma value)</span>
          <span><i class="lg sw navy"></i> Delivered</span>
          <span><i class="lg sw gold"></i> Paid to supplier</span>
          <span><i class="lg sw green"></i> Paid by client</span>
        </div>
      </div>
    </div>`;
}

/* compact money for timeline labels: €9,961 / €12.3k / €1.2M */
function shortMoney(v, cur) {
  const sym = { EUR: '€', USD: '$', GBP: '£', RUB: '₽' }[cur] || '';
  const a = Math.abs(Number(v) || 0);
  if (a >= 1e6) return sym + (a / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (a >= 1e5) return sym + Math.round(a / 1e3) + 'k';
  return sym + Math.round(a).toLocaleString('en-US');
}
function gdDate(s) {
  if (!s) return 'no date';
  const [y, mo, d] = String(s).slice(0, 10).split('-').map(Number);
  return `${d} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][mo - 1] || ''}` + (y !== new Date().getFullYear() ? ` ${String(y).slice(2)}` : '');
}
/* a delivered-vs-paid comparison: two bars over the same scale, plus a verdict */
function gdCheck(x, y, w, label, total, a, aCls, b, bCls, verdict, tall) {
  const sc = (v) => Math.max(0, Math.min(w, total > 0 ? (w * v) / total : 0));
  const vy = tall ? y + 58 : y;
  return `<g class="dg-flow" tabindex="0" data-dtip="${esc(verdict.tip)}">
    <rect x="${x}" y="${y - 16}" width="${w}" height="${tall ? 82 : 54}" class="dg-hit"/>
    <text x="${x}" y="${y}" class="dg-lane-r">${esc(label)}</text>
    <text x="${tall ? x : x + w}" y="${vy}" ${tall ? '' : 'text-anchor="end"'} class="dg-verdict ${verdict.cls}">${esc(verdict.text)}</text>
    <rect x="${x}" y="${y + 10}" width="${w}" height="10" rx="5" class="dg-track"/>
    ${sc(a) > 0 ? `<rect x="${x}" y="${y + 10}" width="${sc(a)}" height="10" rx="5" class="dg-fill ${aCls}"/>` : ''}
    <rect x="${x}" y="${y + 24}" width="${w}" height="10" rx="5" class="dg-track"/>
    ${sc(b) > 0 ? `<rect x="${x}" y="${y + 24}" width="${sc(b)}" height="10" rx="5" class="dg-fill ${bCls}"/>` : ''}
  </g>`;
}
/* delivery timeline markers, evenly spaced; long histories collapse the oldest */
function gdMarkers(G, pts, tall) {
  const MAX = tall ? 7 : 6;
  const shown = G.dels.length > MAX ? G.dels.slice(-MAX) : G.dels;
  const hidden = G.dels.length - shown.length;
  const out = shown.map((dl, i) => {
    const [x, y] = pts(i, shown.length);
    const val = Number(dl.proforma_allocated) || 0;
    const tip = `Delivery ${dl.invoice_number}\n${fdate(dl.delivery_date || dl.issue_date)} · ${G.m(val)} (proforma value)` + (dl.quantity ? `\nQuantity: ${dl.quantity}` : '');
    const lbl = tall
      ? `<text x="${x + 18}" y="${y - 2}" class="dg-fsub">${esc(gdDate(dl.delivery_date || dl.issue_date))}</text><text x="${x + 18}" y="${y + 15}" class="dg-famt goods sm">${esc(shortMoney(val, G.cur))}</text>`
      : `<text x="${x}" y="${y - 16}" text-anchor="middle" class="dg-fsub">${esc(gdDate(dl.delivery_date || dl.issue_date))}</text><text x="${x}" y="${y + 28}" text-anchor="middle" class="dg-famt goods sm">${esc(shortMoney(val, G.cur))}</text>`;
    return `<g class="dg-flow" tabindex="0" data-dtip="${esc(tip)}"><circle cx="${x}" cy="${y}" r="9" class="dg-dot"/><text x="${x}" y="${y + 4}" text-anchor="middle" class="dg-dotn">${i + 1 + hidden}</text>${lbl}</g>`;
  }).join('');
  return { out, hidden };
}
function gdSvgWide(G) {
  const id = 'gdw';
  const x0 = 290, x1 = 710, ty = 158;
  const mk = gdMarkers(G, (i, n) => [n === 1 ? (x0 + x1) / 2 : x0 + 30 + (i * (x1 - x0 - 60)) / (n - 1), ty], false);
  return `<svg class="dg-svg dg-wide" viewBox="0 0 1000 420" role="img" aria-label="Goods flow diagram">
    ${dgDefs(id)}
    <text x="20" y="22" class="dg-lane goods">GOODS FLOW · no effect on money</text>
    <text x="980" y="22" text-anchor="end" class="dg-lane-r">Proforma pool ${esc(G.m(G.proforma))} · ${Math.round(G.pct)}% delivered</text>
    ${dgGoodsPool(id, 20, 32, 960, 14, G)}
    ${dgNode(G.supNode, 20, 72, 250, 176)}
    ${dgNode(G.cliNode, 730, 72, 250, 176)}
    <g class="dg-flow" tabindex="0" data-dtip="${esc(G.dels.length ? `${G.dels.length} ${G.dels.length === 1 ? 'delivery' : 'deliveries'} totalling ${G.m(G.delivered)} (proforma value).\nStill to deliver ${G.m(G.remaining)}.` : 'No deliveries yet. The supplier ships in batches as goods are produced.')}">
      <rect x="274" y="96" width="452" height="120" class="dg-hit"/>
      <text x="500" y="102" text-anchor="middle" class="dg-flabel goods">SHIPPED DIRECTLY · ${G.dels.length} ${G.dels.length === 1 ? 'DELIVERY' : 'DELIVERIES'}</text>
      <path d="M274,${ty} H724" class="dg-goods" marker-end="url(#${id}-ag)"/>
      ${G.dels.length ? '' : `<text x="500" y="${ty + 30}" text-anchor="middle" class="dg-fsub">no deliveries yet</text>`}
      ${mk.hidden ? `<text x="${x0 + 4}" y="${ty + 48}" class="dg-fsub">+${mk.hidden} earlier</text>` : ''}
    </g>
    ${mk.out}
    ${gdCheck(20, 296, 960, `SUPPLIER · delivered ${G.m(G.delivered)} vs paid ${G.m(G.paidOut)}`, Math.max(G.proforma, G.delivered, G.paidOut), G.delivered, 'navy', G.paidOut, 'gold', G.sup, false)}
    ${gdCheck(20, 368, 960, `CLIENT · goods received ${G.m(G.deliveredClient)} vs paid ${G.m(G.received)}`, Math.max(G.invoice, G.deliveredClient, G.received), G.deliveredClient, 'navy', G.received, 'money', G.cli, false)}
  </svg>`;
}
function gdSvgTall(G) {
  const id = 'gdt';
  const tx = 60, y0 = 270, y1 = 470;
  const mk = gdMarkers(G, (i, n) => [tx, n === 1 ? (y0 + y1) / 2 : y0 + 18 + (i * (y1 - y0 - 36)) / (n - 1)], true);
  return `<svg class="dg-svg dg-tall" viewBox="0 0 400 860" role="img" aria-label="Goods flow diagram">
    ${dgDefs(id)}
    <text x="20" y="22" class="dg-lane goods">GOODS FLOW · no effect on money</text>
    <text x="20" y="42" class="dg-lane-r">Proforma pool ${esc(G.m(G.proforma))} · ${Math.round(G.pct)}% delivered</text>
    ${dgGoodsPool(id, 20, 52, 360, 14, G)}
    ${dgNode(G.supNode, 20, 84, 360, 176)}
    <g class="dg-flow" tabindex="0" data-dtip="${esc(G.dels.length ? `${G.dels.length} deliveries totalling ${G.m(G.delivered)}.` : 'No deliveries yet.')}">
      <rect x="20" y="262" width="360" height="218" class="dg-hit"/>
      <path d="M${tx},264 V474" class="dg-goods" marker-end="url(#${id}-ag)"/>
      ${G.dels.length ? '' : `<text x="${tx + 18}" y="372" class="dg-fsub">no deliveries yet</text>`}
      ${mk.hidden ? `<text x="${tx + 150}" y="372" class="dg-fsub">+${mk.hidden} earlier</text>` : ''}
    </g>
    ${mk.out}
    ${dgNode(G.cliNode, 20, 480, 360, 176)}
    ${gdCheck(20, 692, 360, 'SUPPLIER · delivered vs paid', Math.max(G.proforma, G.delivered, G.paidOut), G.delivered, 'navy', G.paidOut, 'gold', G.sup, true)}
    ${gdCheck(20, 784, 360, 'CLIENT · received vs paid', Math.max(G.invoice, G.deliveredClient, G.received), G.deliveredClient, 'navy', G.received, 'money', G.cli, true)}
  </svg>`;
}

/* ---- Payments card: money IN from client, money OUT to supplier ---- */
function paymentsCard(d, cur, ro) {
  const c = d.computed;
  const ins = d.customerPayments.filter((p) => p.status !== 'void');
  const outs = d.supplierPayments.filter((p) => p.status !== 'void');
  const paidOut = outs.reduce((a, p) => a + Number(p.amount || 0), 0);

  const inRows = ins.length ? ins.map((p) => `
    <div class="pay-row in">
      <div class="pay-when">${fdate(p.date)}${p.status === 'pending' ? ' <span class="pill amber">pending</span>' : ''}</div>
      <div class="pay-what">Received from ${esc(d.deal.customer_name)}${p.bank_ref ? ` <span class="meta">· ${esc(p.bank_ref)}</span>` : ''}
        ${p.kept !== undefined ? `<div class="meta">includes ${money(p.kept, cur)} of the 4% fee</div>` : ''}</div>
      <div class="pay-amt green">+ ${money(p.amount_received, cur)}</div>
      <div class="pay-act">
        ${docFor(d, 'customer_payment', p.id) ? `<span class="pill green">proof</span>` : `<span class="pill gray">no proof</span>`}
        ${isAdmin() && !ro ? `<button class="btn sm" data-upload='${uploadAttr('customer_payment', p.id)}'>Proof</button>
        <button class="btn sm danger" data-void='customer_payment:${p.id}'>Void</button>` : ''}
      </div>
    </div>`).join('') : '<div class="meta" style="padding:8px 0">No payments received yet.</div>';

  const outRows = outs.length ? outs.map((p) => `
    <div class="pay-row out">
      <div class="pay-when">${fdate(p.date)}${p.status === 'pending' ? ' <span class="pill amber">pending</span>' : ''}</div>
      <div class="pay-what">Paid to ${esc(d.deal.supplier_name)}${p.bank_ref ? ` <span class="meta">· ${esc(p.bank_ref)}</span>` : ''}</div>
      <div class="pay-amt blue">− ${money(p.amount, cur)}</div>
      <div class="pay-act">
        ${docFor(d, 'supplier_payment', p.id) ? `<span class="pill green">proof</span>` : `<span class="pill gray">no proof</span>`}
        ${isAdmin() && !ro ? `<button class="btn sm" data-upload='${uploadAttr('supplier_payment', p.id)}'>Proof</button>
        <button class="btn sm danger" data-void='supplier_payment:${p.id}'>Void</button>` : ''}
      </div>
    </div>`).join('') : '<div class="meta" style="padding:8px 0">No payments sent yet.</div>';

  const body = `
    <div class="pay-split">
      <div class="pay-col">
        <div class="pay-head"><span class="pay-title in">Payments in</span><b class="green">${money(c.totalReceived, cur)}</b></div>
        ${inRows}
      </div>
      <div class="pay-col">
        <div class="pay-head"><span class="pay-title out">Payments out</span><b class="blue">${money(paidOut, cur)}</b></div>
        ${outRows}
      </div>
    </div>
    ${collapsible('pay-detail', 'Show payment details', `
      <div class="rowset">
        ${row(isAdmin() ? 'Total received from client' : 'Total you have paid', money(c.totalReceived, cur), 'green')}
        ${row('Total paid to supplier', money(paidOut, cur))}
        ${row(isAdmin() ? 'Still to collect' : 'Still to pay', money(c.customerBalance, cur), c.customerBalance > 0.005 ? 'amber' : 'green')}
        ${isAdmin() ? row('Cash held now', money(c.heldInHouse, cur)) : ''}
        ${isAdmin() ? row('Our income earned', money(c.incomeKept, cur) + ' of ' + money(c.feeTotal, cur), 'gold') : row('4% fee paid so far', money(c.feePaid, cur), 'gold')}
        ${isAdmin() ? row('Income still to come', money(c.incomeRemaining, cur), c.incomeRemaining > 0.005 ? 'amber' : 'green') : row('4% fee remaining', money(c.feeRemaining, cur), c.feeRemaining > 0.005 ? 'amber' : 'green')}
      </div>
      ${sectionCustomerJourneyRows(d, cur)}
    `)}`;
  const actions = isAdmin() && !ro
    ? `<button class="btn sm primary" data-next="add-cust-pay">＋ Money in</button> <button class="btn sm" data-next="add-supp-pay">＋ Money out</button>`
    : '';
  return card('Payments', body, actions);
}

/* full per-payment breakdown, shown inside the details drop-down */
function sectionCustomerJourneyRows(d, cur) {
  const rows = d.customerPayments.filter((p) => p.status !== 'void');
  if (!rows.length) return '';
  return `<div class="section-title" style="margin:16px 0 8px">Each payment in detail</div>
    <div class="journey">${rows.map((p) => custRow(p, cur, d)).join('')}</div>`;
}

/* ---- Delivery card: the goods flow against the proforma (no money effect) ---- */
function deliveryCard(d, cur) {
  const c = d.computed;
  const pctW = Math.min(100, c.deliveryPct || 0);
  const ro = d.deal.status !== 'active';
  const posted = (d.supplierInvoices || []).filter((x) => x.status === 'posted').length;
  const body = `
    <div class="dl-head">
      <div><div class="dl-big">${money(c.deliveredValue, cur)}</div>
        <div class="meta">delivered of the ${money(c.deliveryTarget, cur)} proforma · ${pct(c.deliveryPct)}</div></div>
      <div class="dl-tags">
        ${c.deliveryOutstanding > 0.005 ? `<span class="flow-tag amber">Still to deliver ${money(c.deliveryOutstanding, cur)}</span>` : `<span class="flow-tag green">Fully delivered</span>`}
        ${c.overDelivery > 0.005 ? `<span class="flow-tag red">Over-delivered ${money(c.overDelivery, cur)}</span>` : ''}
        <span class="tag">${posted} ${posted === 1 ? 'delivery' : 'deliveries'}</span>
      </div>
    </div>
    <div class="progress goods ${c.overDelivery > 0 ? 'over' : ''}" style="height:10px;margin:10px 0 14px"><span style="width:${pctW}%"></span></div>
    ${deliveriesTable(d, cur)}`;
  const addBtn = !ro && canWrite() ? `<button class="btn sm primary" data-next="add-supp-inv">＋ Add a delivery</button>` : '';
  return card('Goods flow — deliveries (no effect on money)', body, addBtn);
}

/* ---- Section 6: closeout ---- */
function sectionCloseout(c, cur, deal) {
  const reconciled = c.customerBalance < 0.005 && c.supplierOpenToPay < 0.005 && c.companyMoneyFronted < 0.005;
  const body = `
    <div class="rowset">
      <div class="r"><div class="k"><b>Client</b></div><div class="v"></div></div>
      ${row('Still to collect', money(c.customerBalance, cur), c.customerBalance > 0 ? 'amber' : 'green')}
      ${row('Overpaid by client', money(c.customerOverpayment, cur), c.customerOverpayment > 0 ? 'amber' : '')}
      <div class="r"><div class="k"><b>Supplier</b></div><div class="v"></div></div>
      ${row('Open to be paid', money(c.supplierOpenToPay, cur), c.supplierOpenToPay > 0 ? 'amber' : 'green')}
      ${row('Overpaid to supplier', money(c.supplierOverpaid, cur), c.supplierOverpaid > 0 ? 'amber' : '')}
      ${isAdmin() ? `
      <div class="r"><div class="k"><b>Our position</b></div><div class="v"></div></div>
      ${row('Cash held in-house', money(c.heldInHouse, cur))}
      ${row('Our income', money(c.incomeKept, cur) + ' / ' + money(c.incomeExpectedTotal, cur), 'gold')}
      ${row(c.supplierShareHeld >= 0 ? "Supplier's share still held" : 'Company money fronted', money(Math.abs(c.supplierShareHeld), cur), c.supplierShareHeld >= 0 ? '' : 'red')}
      ` : `
      <div class="r"><div class="k"><b>Client settlement</b></div><div class="v"></div></div>
      ${row('Delivered so far', money(c.clientDueToDate, cur))}
      ${row('Unpaid for delivered goods', money(c.clientUnderpaidToDate, cur), c.clientUnderpaidToDate > 0.005 ? 'red' : 'green')}
      `}
      <div class="r"><div class="k"><b>Delivery (tracking only)</b></div><div class="v"></div></div>
      ${row('Delivered', money(c.deliveredValue, cur) + ' (' + pct(c.deliveryPct) + ')', 'green')}
      ${c.deliveryOutstanding > 0 ? row('Awaiting delivery', money(c.deliveryOutstanding, cur), 'amber') : ''}
    </div>
    ${reconciled ? `<div class="alert info" style="margin-top:14px">Money reconciles — client fully paid and supplier fully paid. Deliveries are tracked separately and don't block completion.</div>`
      : `<div class="alert warn" style="margin-top:14px">Not fully settled — collect the client balance and pay the supplier to close.</div>`}
    ${isAdmin() && deal.status === 'active' ? `<button class="btn primary" id="closeout-complete" style="margin-top:12px">Mark deal complete</button>` : ''}
  `;
  return `<div class="card" id="closeout"><div class="card-h"><h3>Closeout</h3></div><div class="card-b">${body}</div></div>`;
}

/* ---- Documents ---- */
const DOC_GROUPS = ['Customer invoices', 'Supplier proformas', 'Supplier commercial invoices', 'Customer payment confirmations', 'Supplier payment confirmations', 'Delivery notes', 'Shipping documents', 'Manufacturer balance letters', 'Other documents'];
function sectionDocuments(d, cur) {
  const byCat = {}; DOC_GROUPS.forEach((g) => (byCat[g] = []));
  d.documents.forEach((doc) => { (byCat[doc.category] || (byCat['Other documents'])).push(doc); });
  const groups = DOC_GROUPS.map((g) => {
    const items = byCat[g] || [];
    return `<div style="margin-bottom:14px">
      <div class="section-title" style="margin-bottom:8px">${g} <span class="meta">(${items.length})</span></div>
      ${items.length ? items.map((doc) => docItem(doc)).join('') : '<div class="meta">None attached.</div>'}
    </div>`;
  }).join('');
  const upBtn = canWrite() ? `<button class="btn sm primary" id="upload-doc">Upload document</button>` : '';
  return card('Documents', groups, upBtn);
}
function docItem(doc) {
  const pillCls = { approved: 'green', awaiting: 'amber', flagged: 'red', missing: 'gray', attached: 'blue' }[doc.status] || 'gray';
  return `<div class="jrow" style="padding:10px 14px;margin-bottom:8px">
    <div class="jrow-top">
      <div><a href="#" data-preview="${doc.id}">${esc(doc.original_name)}</a>
        <span class="pill ${pillCls}">${esc(doc.status)}</span></div>
      <div>${isAdmin() ? `
        <button class="btn sm" data-docstatus="${doc.id}:approved">Approve</button>
        <button class="btn sm" data-docstatus="${doc.id}:flagged">Flag</button>
        <button class="btn sm danger" data-docdel="${doc.id}">Delete</button>` : ''}</div>
    </div>
    ${doc.link_type ? `<div class="meta" style="margin-top:6px">Linked to ${esc(doc.link_type.replace('_', ' '))} #${doc.link_id}</div>` : ''}
  </div>`;
}

/* ---- Audit ---- */
function sectionAudit() {
  return `<div class="card"><div class="card-b">
    <button class="collapse-h" id="audit-toggle"><span class="chev">▶</span> Audit history</button>
    <div id="audit-body" class="hidden" style="margin-top:10px"></div>
  </div></div>`;
}

/* ---- generic UI helpers ---- */
function card(title, bodyHtml, headerActions = '') {
  return `<div class="card"><div class="card-h"><h3>${esc(title)}</h3><div style="flex:1"></div>${headerActions}</div><div class="card-b">${bodyHtml}</div></div>`;
}
function collapsible(id, label, inner, open = false) {
  return `<button class="collapse-h ${open ? 'open' : ''}" data-collapse="${id}"><span class="chev">▶</span> ${esc(label)}</button>
    <div id="col-${id}" class="${open ? '' : 'hidden'}" style="margin-top:10px">${inner}</div>`;
}
function docFor(d, type, id) { return d.documents.find((x) => x.link_type === type && x.link_id === id); }
function uploadAttr(type, id) { return type + ':' + id; }

/* ---- wire up deal page events ---- */
function wireDeal(d) {
  const deal = d.deal;
  document.getElementById('back').onclick = () => go('deals');
  document.getElementById('to-flow').onclick = () => go('flow', { id: deal.id });
  const drb = document.getElementById('deal-report');
  if (drb) drb.onclick = () => partnerReportModal([{ id: deal.id, ref: deal.ref, title: deal.title, customer_name: deal.customer_name }], [deal.id]);
  const bind = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
  bind('complete', () => completeDeal(deal));
  bind('closeout-complete', () => completeDeal(deal));
  bind('archive', () => lifecycleAction(deal.id, 'archive', 'Archive this deal?'));
  bind('reopen', () => lifecycleAction(deal.id, 'reopen', 'Reopen this deal for editing?'));
  bind('editdeal', () => dealDetailsModal(deal.id, () => renderDeal()));
  bind('upload-doc', () => uploadModal(deal.id, null, null));
  bind('audit-toggle', toggleAudit);

  document.querySelectorAll('[data-collapse]').forEach((b) => (b.onclick = () => {
    b.classList.toggle('open');
    document.getElementById('col-' + b.dataset.collapse).classList.toggle('hidden');
  }));
  document.querySelectorAll('[data-next]').forEach((b) => (b.onclick = () => handleNext(b.dataset.next, d)));
  document.querySelectorAll('[data-void]').forEach((b) => (b.onclick = () => {
    const [type, id] = b.dataset.void.split(':'); voidModal(type, Number(id));
  }));
  document.querySelectorAll('[data-upload]').forEach((b) => (b.onclick = () => {
    const [type, id] = b.dataset.upload.split(':'); uploadModal(deal.id, type, Number(id));
  }));
  document.querySelectorAll('[data-docstatus]').forEach((b) => (b.onclick = async () => {
    const [id, status] = b.dataset.docstatus.split(':');
    try { await api('/documents/' + id, { method: 'PATCH', body: { status } }); ok('Document ' + status + '.'); renderDeal(); }
    catch (e) { err(e.message); }
  }));
  // Simple quick actions
  bind('q-received', () => custPayModal(deal, d.computed));
  bind('q-paid', () => suppPayModal(deal, d));
  bind('q-delivery', () => suppInvModal(deal, d.computed));
  bind('details-toggle', (ev) => {
    const t = document.getElementById('details-toggle');
    t.classList.toggle('open');
    document.getElementById('details-body').classList.toggle('hidden');
  });
  document.querySelectorAll('[data-tileupload]').forEach((b) => (b.onclick = () => quickUpload(deal.id, b.dataset.tileupload)));
  document.querySelectorAll('[data-preview]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); docPreview(Number(a.dataset.preview)); }));
  wireDeliveryButtons(d);
  wireClosurePanel(d);
  document.querySelectorAll('[data-docdel]').forEach((b) => (b.onclick = () => {
    const id = b.dataset.docdel;
    const close = openModal('Delete file', '<p>Delete this uploaded file? This cannot be undone.</p>',
      `<button class="btn" id="dd_no">Cancel</button><button class="btn danger" id="dd_yes">Delete file</button>`);
    document.getElementById('dd_no').onclick = close;
    document.getElementById('dd_yes').onclick = async () => {
      try { await api('/documents/' + id, { method: 'DELETE' }); close(); ok('File deleted.'); renderDeal(); }
      catch (e) { err(e.message); close(); }
    };
  }));
}

/* One-click document preview (PDF in a frame, images inline). */
function docPreview(id) {
  const meta = (State.cache.docs && State.cache.docs[id]) || { mime: '', name: 'Document' };
  const url = '/api/documents/' + id + '/file';
  const isImg = /^image\//.test(meta.mime);
  const body = isImg
    ? `<img src="${url}" alt="${esc(meta.name)}" style="max-width:100%;border-radius:8px;display:block;margin:0 auto" />`
    : `<iframe src="${url}" style="width:100%;height:72vh;border:1px solid var(--border);border-radius:8px"></iframe>`;
  const footer = `<a class="btn" href="${url}" target="_blank">Open in new tab</a><button class="btn primary" id="pv_close">Close</button>`;
  const close = openModal(meta.name, body, footer, { wide: true });
  document.getElementById('pv_close').onclick = close;
}

/* One-click upload: open the file picker, then send immediately. */
function quickUpload(dealId, category) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/pdf,image/png,image/jpeg';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    fd.append('category', category);
    try { await api('/deals/' + dealId + '/documents', { method: 'POST', body: fd }); ok('Uploaded.'); renderDeal(); }
    catch (e) { err(e.message); }
  };
  input.click();
}
function handleNext(code, d) {
  const deal = d.deal;
  if (code === 'add-cust-pay') return custPayModal(deal, d.computed);
  if (code === 'add-supp-pay') return suppPayModal(deal, d);
  if (code === 'add-supp-inv') return suppInvModal(deal, d.computed);
  if (code === 'scroll-closeout') return document.getElementById('closeout').scrollIntoView({ behavior: 'smooth' });
  if (code === 'complete') return completeDeal(deal);
}
async function toggleAudit() {
  const btn = document.getElementById('audit-toggle'), body = document.getElementById('audit-body');
  btn.classList.toggle('open'); body.classList.toggle('hidden');
  if (!body.dataset.loaded) {
    try {
      const rows = await api('/deals/' + State.route.id + '/audit');
      body.innerHTML = rows.length ? `<table class="grid"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Detail</th></tr></thead><tbody>${
        rows.map((r) => `<tr><td data-label="When">${esc(r.created_at)}</td><td data-label="Who">${esc(r.actor_name || '—')}</td><td data-label="Action">${esc(r.action)}</td><td data-label="Detail" class="meta">${esc((r.detail || '').slice(0, 120))}</td></tr>`).join('')
      }</tbody></table>` : '<div class="meta">No audit entries.</div>';
      body.dataset.loaded = '1';
    } catch (e) { body.innerHTML = '<div class="meta">Could not load audit.</div>'; }
  }
}

/* ---- customer payment modal (live 4% preview) ---- */
function custPayModal(deal, c) {
  const cur = deal.currency;
  const body = `
    <div class="form-row">
      <div class="field"><label>Amount received</label><input id="cp_amt" inputmode="decimal" placeholder="e.g. 11 000,50" autofocus />
        <div class="hint">Accepts 11000 · 11,000 · 11,000.50 · 11.000,50 · 11 000,50</div></div>
      <div class="field"><label>Date</label><input id="cp_date" type="date" value="${today()}" /></div>
    </div>
    <div class="field"><label>Payment type</label>
      <select id="cp_type"><option value="payment">Payment</option><option value="prepayment">Prepayment</option><option value="balance">Balance</option></select></div>
    <div class="calc-box" id="cp_calc"><div class="meta">Enter an amount to see the split.</div></div>
    <button class="collapse-h" id="cp_more"><span class="chev">▶</span> More details</button>
    <div id="cp_more_b" class="hidden" style="margin-top:8px">
      <div class="field"><label>Bank reference</label><input id="cp_ref" /></div>
      <div class="field"><label>Notes</label><textarea id="cp_notes"></textarea></div>
    </div>
    <div id="cp_err" class="alert err hidden"></div>`;
  const footer = `<button class="btn" id="cp_cancel">Cancel</button><button class="btn primary" id="cp_save">Save payment</button>`;
  const close = openModal(isOffice() ? 'Propose customer payment' : 'Record customer payment', body, footer);
  document.getElementById('cp_cancel').onclick = close;
  document.getElementById('cp_more').onclick = (e) => {
    e.currentTarget.classList.toggle('open'); document.getElementById('cp_more_b').classList.toggle('hidden');
  };
  const amt = document.getElementById('cp_amt');
  const calc = document.getElementById('cp_calc');
  const remaining = Math.max(0, c.invoiceTotal - c.totalApplied);
  const update = () => {
    const val = parseAmount(amt.value);
    if (!Number.isFinite(val) || val <= 0) { calc.innerHTML = '<div class="meta">Enter an amount to see the split.</div>'; return; }
    const applied = Math.min(val, remaining);
    const kept = Math.round(applied * c.rate * 100) / 100;
    const reserved = Math.round((applied - kept) * 100) / 100;
    const over = Math.round((val - applied) * 100) / 100;
    const balAfter = Math.max(0, remaining - applied);
    calc.innerHTML = `
      <div class="line"><span>We read this as</span><span class="v tnum">${money(val, cur)}</span></div>
      <div class="line"><span>Applied to deal</span><span class="v tnum">${money(applied, cur)}</span></div>
      <div class="line kept"><span>Our 4% (kept)</span><span class="v tnum">${money(kept, cur)}</span></div>
      <div class="line reserved"><span>Reserved for supplier (96%)</span><span class="v tnum">${money(reserved, cur)}</span></div>
      ${over > 0 ? `<div class="line"><span>Overpayment</span><span class="v tnum">${money(over, cur)}</span></div>` : ''}
      <div class="line total"><span>Customer balance after</span><span class="v tnum">${money(balAfter, cur)}</span></div>`;
  };
  amt.addEventListener('input', update);
  document.getElementById('cp_save').onclick = async () => {
    const payload = { amount: amt.value, date: v('cp_date'), ptype: v('cp_type'), bank_ref: v('cp_ref'), notes: v('cp_notes') };
    try {
      const r = await api('/deals/' + deal.id + '/customer-payments', { method: 'POST', body: payload });
      close(); ok(r.status === 'pending' ? 'Submitted for approval.' : 'Payment recorded.'); renderDeal();
    } catch (e) { showErr('cp_err', e.message); }
  };
}

/* ---- supplier payment / prepayment modal ---- */
function suppPayModal(deal, d) {
  const cur = deal.currency, c = d.computed;
  const body = `
    <div class="alert info">Owed to supplier: <b>${money(c.supplierOwed, cur)}</b> · Paid so far: <b>${money(c.totalPaidToSupplier, cur)}</b> · Open: <b>${money(c.supplierOpenToPay, cur)}</b></div>
    ${(() => {
      const cps = d.customerPayments.filter((p) => p.status !== 'void').slice().sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.id - b.id);
      if (!cps.length) return '';
      const last = cps[cps.length - 1];
      return `<div class="field"><label>Forwarding which client payment?</label>
        <select id="sp_fund">${cps.map((p) => `<option value="${p.id}" ${p.id === last.id ? 'selected' : ''}>${fdate(p.date)} — ${money(p.amount_received, cur)}</option>`).join('')}
        <option value="">Not linked to a client payment</option></select>
        <div class="hint">Used in the partner report: "of which … was sent to the supplier".</div></div>`;
    })()}
    <div class="form-row">
      <div class="field"><label>Amount paid to supplier</label><input id="sp_amt" inputmode="decimal" value="${c.supplierOpenToPay > 0 ? c.supplierOpenToPay : ''}" autofocus />
        <div class="hint">Partial payments are fine. This is independent of deliveries.</div></div>
      <div class="field"><label>Date</label><input id="sp_date" type="date" value="${today()}" /></div>
    </div>
    <button class="collapse-h" id="sp_more"><span class="chev">▶</span> More details</button>
    <div id="sp_more_b" class="hidden" style="margin-top:8px">
      <div class="field"><label>Bank reference</label><input id="sp_ref" /></div>
      <div class="field"><label>Notes</label><textarea id="sp_notes"></textarea></div>
    </div>
    <div id="sp_err" class="alert err hidden"></div>`;
  const footer = `<button class="btn" id="sp_cancel">Cancel</button><button class="btn primary" id="sp_save">Save payment</button>`;
  const close = openModal(isOffice() ? 'Propose supplier payment' : 'Record payment to supplier', body, footer);
  document.getElementById('sp_cancel').onclick = close;
  document.getElementById('sp_more').onclick = (e) => { e.currentTarget.classList.toggle('open'); document.getElementById('sp_more_b').classList.toggle('hidden'); };
  document.getElementById('sp_save').onclick = async () => {
    const fund = document.getElementById('sp_fund');
    const payload = { amount: v('sp_amt'), date: v('sp_date'), bank_ref: v('sp_ref'), notes: v('sp_notes'), funded_by: fund && fund.value ? Number(fund.value) : null };
    try {
      const r = await api('/deals/' + deal.id + '/supplier-payments', { method: 'POST', body: payload });
      close(); ok(r.status === 'pending' ? 'Submitted for approval.' : 'Payment recorded.'); renderDeal();
    } catch (e) { showErr('sp_err', e.message); }
  };
}

/* ---- delivery modal: file is mandatory, no money effect ---- */
function suppInvModal(deal, c) {
  const cur = deal.currency;
  const body = `
    <div class="alert info">A delivery reduces the <b>proforma pool</b> — what the supplier still has to deliver. It does <b>not</b> change any payment. The delivery invoice file is required.</div>
    <div class="form-row">
      <div class="field"><label>Delivery invoice number</label><input id="si_num" autofocus /></div>
      <div class="field"><label>Delivery date</label><input id="si_deliv" type="date" value="${today()}" /></div>
    </div>

    <div class="form-row">
      <div class="field"><label>Proforma value delivered</label><input id="si_amt" inputmode="decimal" />
        <div class="hint">As stated on the delivery invoice. Proforma ${money(deal.proforma_total, cur)} · still to deliver ${money(c.deliveryOutstanding, cur)}</div></div>
      <div class="field"><label>Quantity (optional)</label><input id="si_qty" placeholder="e.g. 5,000 units" /></div>
    </div>
    <div class="upload-req">
      <label class="ureq" id="dl_lab"><span class="uicon">🚚</span>
        <span class="utx"><b>Delivery invoice file (required)</b><em id="dl_name">No file chosen</em></span>
        <input type="file" id="si_file" accept="application/pdf,image/png,image/jpeg" hidden /></label>
    </div>
    <div class="field" style="margin-top:12px"><label>Notes</label><textarea id="si_notes"></textarea></div>
    <div id="si_err" class="alert err hidden"></div>`;
  const footer = `<button class="btn" id="si_cancel">Cancel</button><button class="btn primary" id="si_save">Save delivery</button>`;
  const close = openModal(isOffice() ? 'Propose delivery (needs approval)' : 'Add a delivery', body, footer, { wide: true });
  document.getElementById('si_cancel').onclick = close;
  const fileIn = document.getElementById('si_file');
  fileIn.addEventListener('change', () => {
    const f = fileIn.files[0];
    document.getElementById('dl_name').textContent = f ? f.name : 'No file chosen';
    document.getElementById('dl_lab').classList.toggle('ok', !!f);
  });
  document.getElementById('si_save').onclick = async () => {
    const file = fileIn.files[0];
    if (!file) return showErr('si_err', 'Attach the delivery invoice file — a delivery cannot be saved without it.');
    const fd = new FormData();
    fd.append('file', file);
    fd.append('invoice_number', v('si_num'));
    fd.append('delivery_date', v('si_deliv'));
    fd.append('basis', 'supplier');
    fd.append('amount', v('si_amt'));
    fd.append('quantity', v('si_qty'));
    fd.append('notes', v('si_notes'));
    try {
      const r = await api('/deals/' + deal.id + '/supplier-invoices', { method: 'POST', body: fd });
      close(); ok(r.status === 'pending' ? 'Sent for approval.' : 'Delivery recorded.'); renderDeal();
    } catch (e) { showErr('si_err', e.message); }
  };
}

/* ---- upload modal ---- */
function uploadModal(dealId, linkType, linkId) {
  const preselect = { customer_payment: 'Customer payment confirmations', supplier_payment: 'Supplier payment confirmations', supplier_invoice: 'Supplier commercial invoices' }[linkType] || 'Other documents';
  const body = `
    <div class="field"><label>Category</label>
      <select id="up_cat">${DOC_GROUPS.map((g) => `<option ${g === preselect ? 'selected' : ''}>${g}</option>`).join('')}</select></div>
    <div class="field"><label>File (PDF, PNG or JPEG · max 25 MB)</label><input id="up_file" type="file" accept="application/pdf,image/png,image/jpeg" /></div>
    ${linkType ? `<div class="meta">This file will be linked to ${esc(linkType.replace('_', ' '))} #${linkId}.</div>` : ''}
    <div id="up_err" class="alert err hidden" style="margin-top:12px"></div>`;
  const footer = `<button class="btn" id="up_cancel">Cancel</button><button class="btn primary" id="up_save">Upload</button>`;
  const close = openModal('Upload document', body, footer);
  document.getElementById('up_cancel').onclick = close;
  document.getElementById('up_save').onclick = async () => {
    const file = document.getElementById('up_file').files[0];
    if (!file) return showErr('up_err', 'Choose a file first.');
    const fd = new FormData();
    fd.append('file', file);
    fd.append('category', document.getElementById('up_cat').value);
    if (linkType) { fd.append('link_type', linkType); fd.append('link_id', linkId); }
    try { await api('/deals/' + dealId + '/documents', { method: 'POST', body: fd }); close(); ok('Document uploaded.'); renderDeal(); }
    catch (e) { showErr('up_err', e.message); }
  };
}

/* ---- void modal ---- */
function voidModal(type, id) {
  const label = type.replace('_', ' ');
  const body = `<p>Voiding keeps the original record in the audit history but removes it from all totals.</p>
    <div class="field"><label>Reason (required)</label><textarea id="vd_reason" autofocus></textarea></div>
    <div id="vd_err" class="alert err hidden"></div>`;
  const footer = `<button class="btn" id="vd_cancel">Cancel</button><button class="btn danger" id="vd_go">Void ${esc(label)}</button>`;
  const close = openModal('Void ' + label, body, footer);
  document.getElementById('vd_cancel').onclick = close;
  document.getElementById('vd_go').onclick = async () => {
    try { await api('/void/' + type + '/' + id, { method: 'POST', body: { reason: v('vd_reason') } }); close(); ok('Entry voided.'); renderDeal(); }
    catch (e) { showErr('vd_err', e.message); }
  };
}

/* ---- edit deal modal ---- */
function editDealModal(deal, c) {
  const locked = c.totalApplied > 0.005 || c.supplierInvoicesGross > 0.005 || c.supplierPrepaySent > 0.005;
  const body = `
    <div class="field"><label>Title</label><input id="ed_title" value="${esc(deal.title)}" /></div>
    <div class="form-row">
      <div class="field"><label>Customer</label><input id="ed_cust" value="${esc(deal.customer_name)}" /></div>
      <div class="field"><label>Supplier</label><input id="ed_supp" value="${esc(deal.supplier_name)}" /></div>
    </div>
    <div class="form-row">
      <div class="field"><label>Supplier proforma total</label><input id="ed_prof" inputmode="decimal" value="${deal.proforma_total}" /></div>
      <div class="field"><label>Customer invoice total</label><input id="ed_inv" inputmode="decimal" value="${deal.invoice_total}" /></div>
    </div>
    ${locked ? `<div class="alert warn">Financial activity exists — the payment plan and commission rate are locked.</div>` : `
    <div class="form-row">
      <div class="field"><label>Customer prepayment required</label><input id="ed_cprep" inputmode="decimal" value="${deal.customer_prepay_required}" /></div>
      <div class="field"><label>Supplier prepayment required</label><input id="ed_sprep" inputmode="decimal" value="${deal.supplier_prepay_required}" /></div>
    </div>`}
    ${c.totalApplied > 0.005 ? '' : `<div class="field"><label>Commission rate (%)</label><input id="ed_rate" inputmode="decimal" value="${(deal.commission_rate * 100)}" /></div>`}
    <div id="ed_err" class="alert err hidden"></div>`;
  const footer = `<button class="btn" id="ed_cancel">Cancel</button><button class="btn primary" id="ed_save">Save changes</button>`;
  const close = openModal('Edit deal', body, footer);
  document.getElementById('ed_cancel').onclick = close;
  document.getElementById('ed_save').onclick = async () => {
    const payload = { title: v('ed_title'), customer_name: v('ed_cust'), supplier_name: v('ed_supp'), proforma_total: v('ed_prof'), invoice_total: v('ed_inv') };
    if (!locked) { payload.customer_prepay_required = v('ed_cprep'); payload.supplier_prepay_required = v('ed_sprep'); }
    if (document.getElementById('ed_rate')) payload.commission_rate = v('ed_rate');
    try { await api('/deals/' + deal.id, { method: 'PATCH', body: payload }); close(); ok('Deal updated.'); render(); }
    catch (e) { showErr('ed_err', e.message); }
  };
}

/* ---- lifecycle ---- */
/* Mark complete: show the balances first. If the manufacturer still holds our
   money, the deal is completed but waits for their balance letter. */
function completeDeal(deal) {
  const d = State.cache.deal;
  const c = d.computed, cur = deal.currency;
  const posted = (arr) => (arr || []).filter((x) => x.status === 'posted');
  const paidOut = posted(d.supplierPayments).reduce((a, p) => a + Number(p.amount || 0), 0);
  const delivered = c.deliveredValue || 0;
  const mBal = Math.round((paidOut - delivered) * 100) / 100;
  const others = (State._dealList || []).filter((x) => x.id !== deal.id && x.status === 'active');
  const body = `
    <div class="rowset" style="margin-bottom:14px">
      ${row('Paid to the manufacturer', money(paidOut, cur))}
      ${row('Goods delivered (proforma value)', money(delivered, cur))}
      ${row(mBal >= 0 ? 'Held by the manufacturer' : 'Delivered but not paid', money(Math.abs(mBal), cur), Math.abs(mBal) > 0.005 ? 'amber' : 'green')}
      ${row('Client still to pay', money(c.customerBalance, cur), c.customerBalance > 0.005 ? 'amber' : 'green')}
    </div>
    ${mBal > 0.005 ? `
      <div class="alert warn">The manufacturer still holds <b>${money(mBal, cur)}</b>. The deal will be marked <b>completed — awaiting manufacturer letter</b>, and is fully closed once their balance letter is attached.</div>
      <div class="field"><label>How will this balance be settled?</label>
        <label class="rep-item"><input type="radio" name="cl_opt" value="refund" checked/> <span><b>Refund</b> — the manufacturer pays ${money(mBal, cur)} back to us</span></label>
        <label class="rep-item"><input type="radio" name="cl_opt" value="transfer"/> <span><b>Transfer</b> — the balance is carried over to other deals</span></label>
      </div>
      <div class="field hidden" id="cl_note_f"><label>Transfer to which deal(s)?</label>
        ${others.length ? `<select id="cl_note_sel"><option value="">— choose a deal —</option>${others.map((o) => `<option value="${esc(o.ref)}">${esc(o.ref)} — ${esc(o.title)}</option>`).join('')}<option value="__other">Other / write it in</option></select>` : ''}
        <input id="cl_note" placeholder="e.g. EP-2026-003 or the next proforma" class="${others.length ? 'hidden' : ''}" style="margin-top:8px"/></div>`
    : mBal < -0.005 ? `<div class="alert warn">Goods worth <b>${money(-mBal, cur)}</b> have been delivered but not yet paid to the manufacturer. You can still complete the deal, but that payment remains due.</div>`
    : `<div class="alert info">Payments to the manufacturer match the goods delivered — the deal will be fully closed.</div>`}
    <p class="small muted">Completed deals become read-only until an administrator reopens them.</p>
    <div id="cl_err" class="alert err hidden"></div>`;
  const close = openModal('Mark deal complete', body,
    `<button class="btn" id="c_no">Cancel</button><button class="btn primary" id="c_yes">${mBal > 0.005 ? 'Complete — await letter' : 'Mark complete'}</button>`);
  const noteF = document.getElementById('cl_note_f');
  const sel = document.getElementById('cl_note_sel'), note = document.getElementById('cl_note');
  document.querySelectorAll('[name="cl_opt"]').forEach((r) => (r.onchange = () => noteF && noteF.classList.toggle('hidden', r.value !== 'transfer' || !r.checked)));
  if (sel) sel.onchange = () => note.classList.toggle('hidden', sel.value !== '__other');
  document.getElementById('c_no').onclick = close;
  document.getElementById('c_yes').onclick = async () => {
    const opt = (document.querySelector('[name="cl_opt"]:checked') || {}).value || 'refund';
    const target = sel && sel.value && sel.value !== '__other' ? sel.value : (note ? note.value.trim() : '');
    try {
      const r = await api('/deals/' + deal.id + '/complete', { method: 'POST', body: { option: opt, note: opt === 'transfer' ? target : '' } });
      close();
      ok(r.closure_state === 'awaiting_letter' ? 'Completed — now waiting for the manufacturer\'s balance letter.' : 'Deal completed.');
      await renderDeal();
      if (r.closure_state === 'awaiting_letter') letterModal(State.cache.deal);
    } catch (e) { showErr('cl_err', e.message); }
  };
}

/* Panel shown on completed deals: status, open balance, letter upload. */
function closurePanel(d) {
  const deal = d.deal, cur = deal.currency;
  if (!deal.closure_state) return '';
  const letters = (d.documents || []).filter((x) => x.category === 'Manufacturer balance letters');
  const waitingApproval = letters.filter((x) => x.status === 'awaiting');
  const files = letters.length ? `<div class="cp-files">${letters.map((x) => `<a href="#" data-preview="${x.id}">${esc(x.original_name)}</a> <span class="pill ${x.status === 'approved' ? 'green' : 'amber'}">${x.status === 'approved' ? 'approved' : 'awaiting approval'}</span>`).join('<br>')}</div>` : '';
  if (deal.closure_state === 'closed') {
    if (!(Number(deal.closure_balance) > 0.005)) return `<div class="closure-panel done"><div class="cp-head"><span class="cp-state">Completed</span> Fully closed — no open balances.</div></div>`;
    return `<div class="closure-panel done">
      <div class="cp-head"><span class="cp-state">Closed</span> The manufacturer confirmed the balance of <b>${money(deal.closure_balance, cur)}</b> (${deal.closure_option === 'transfer' ? 'transfer to other deals' : 'refund to us'}).</div>
      ${files}
    </div>`;
  }
  const how = deal.closure_option === 'transfer'
    ? `to be <b>transferred to other deals</b>${deal.closure_note ? ` (${esc(deal.closure_note)})` : ''}`
    : 'to be <b>refunded to Europa</b>';
  return `<div class="closure-panel open">
    <div class="cp-head"><span class="cp-state">Completed — not yet closed</span>
      The manufacturer still holds <b>${money(deal.closure_balance, cur)}</b>, ${how}.</div>
    <div class="cp-body">A balance letter from the manufacturer must be attached to close this deal.
      ${waitingApproval.length ? (isAdmin() ? ' A letter has been uploaded — approve it below to close the deal.' : ' Your uploaded letter is waiting for Europa\'s approval.') : ''}</div>
    ${files}
    <div class="btn-row" style="margin-top:12px">
      ${canWrite() ? `<button class="btn primary" id="cp-upload">Upload manufacturer letter</button>` : ''}
      ${isAdmin() ? `<button class="btn" id="cp-letter">Prepare letter to manufacturer</button>` : ''}
      ${isAdmin() && waitingApproval.length ? waitingApproval.map((x) => `<button class="btn" data-cp-approve="${x.id}">Approve ${esc(x.original_name)}</button>`).join('') : ''}
    </div>
  </div>`;
}
function wireClosurePanel(d) {
  const up = document.getElementById('cp-upload');
  if (up) up.onclick = () => quickUpload(d.deal.id, 'Manufacturer balance letters');
  const lt = document.getElementById('cp-letter');
  if (lt) lt.onclick = () => letterModal(d);
  document.querySelectorAll('[data-cp-approve]').forEach((b) => (b.onclick = async () => {
    try { await api('/documents/' + b.dataset.cpApprove, { method: 'PATCH', body: { status: 'approved' } }); ok('Letter approved — deal closed.'); renderDeal(); }
    catch (e) { err(e.message); }
  }));
}

/* ---------- Letter to the manufacturer (deterministic) ---------- */
function letterText(d, option, lang, target) {
  const deal = d.deal, cur = deal.currency, c = d.computed;
  const posted = (arr) => (arr || []).filter((x) => x.status === 'posted');
  const paidOut = posted(d.supplierPayments).reduce((a, p) => a + Number(p.amount || 0), 0);
  const delivered = c.deliveredValue || 0;
  const bal = Number(deal.closure_balance) || Math.max(0, paidOut - delivered);
  const dels = posted(d.supplierInvoices).length;
  const today = new Date().toISOString().slice(0, 10);
  const signer = State.user && State.user.name && State.user.name !== 'Administrator' ? State.user.name + '\n' : '';
  if (lang === 'ru') {
    const n = (v) => ruNum(v) + ' €';
    const settle = option === 'transfer'
      ? `Просим зачесть остаток в размере ${n(bal)} в счёт ${target ? `сделки ${target}` : 'следующих сделок'} и подтвердить это письменно.`
      : `Просим вернуть остаток в размере ${n(bal)} на счёт Europa Pharmaceutical s. r. o. и сообщить ожидаемую дату возврата.`;
    return `Тема: Подтверждение остатка по сделке ${deal.ref}

Уважаемые коллеги ${deal.supplier_name},

По сделке ${deal.ref} (проформа на сумму ${n(deal.proforma_total)}) нами было оплачено ${n(paidOut)}. Поставлено товара на сумму ${n(delivered)} (${dels} ${ruPlural(dels, 'поставка', 'поставки', 'поставок')}).

Таким образом, на вашей стороне остаётся наш остаток в размере ${n(bal)}.

${settle}

Прошу выслать подписанное письмо-подтверждение остатка — после его получения сделка будет закрыта.

С уважением,
${signer}Europa Pharmaceutical s. r. o.
${ruDate(today)}`;
  }
  const n = (v) => money(v, cur);
  const settle = option === 'transfer'
    ? `We propose that this balance of ${n(bal)} is carried over and applied as a credit towards ${target ? `deal ${target}` : 'our upcoming deals'}. Please confirm this in writing.`
    : `We kindly ask you to refund this balance of ${n(bal)} to Europa Pharmaceutical s. r. o. and to let us know the expected refund date.`;
  return `Subject: Balance confirmation — deal ${deal.ref}

Dear ${deal.supplier_name} team,

For deal ${deal.ref} (proforma ${n(deal.proforma_total)}), we have paid you a total of ${n(paidOut)}. Goods delivered to date amount to ${n(delivered)} at proforma value (${dels} ${dels === 1 ? 'delivery' : 'deliveries'}).

This leaves an open balance of ${n(bal)} in our favour.

${settle}

Please send us a signed letter confirming this balance; once we receive it, the deal will be closed on both sides.

Kind regards,
${signer}Europa Pharmaceutical s. r. o.
${fdate(today)}`;
}
function letterModal(d) {
  const deal = d.deal;
  const opt0 = deal.closure_option === 'transfer' ? 'transfer' : 'refund';
  const body = `
    <div class="form-row">
      <div class="field"><label>Settlement</label>
        <select id="lt_opt"><option value="refund" ${opt0 === 'refund' ? 'selected' : ''}>Refund to us</option><option value="transfer" ${opt0 === 'transfer' ? 'selected' : ''}>Transfer to other deals</option></select></div>
      <div class="field"><label>Language</label>
        <select id="lt_lang"><option value="en">English</option><option value="ru">Русский</option></select></div>
    </div>
    <div class="field" id="lt_target_f"><label>Transfer to (deal reference)</label><input id="lt_target" value="${esc(deal.closure_note || '')}" placeholder="e.g. EP-2026-003"/></div>
    <div class="field"><label>Letter — edit freely before copying</label><textarea id="lt_text" class="rep-text" spellcheck="false"></textarea></div>
    <div class="hint">When the manufacturer replies with a signed letter, upload it on this deal to close it.</div>
    <div id="lt_err" class="alert err hidden"></div>`;
  const close = openModal('Letter to manufacturer — ' + deal.ref, body,
    `<button class="btn" id="lt_close">Close</button><button class="btn primary" id="lt_copy">Copy letter</button>`, { wide: true });
  const build = () => {
    const opt = v('lt_opt');
    document.getElementById('lt_target_f').classList.toggle('hidden', opt !== 'transfer');
    document.getElementById('lt_text').value = letterText(d, opt, v('lt_lang'), v('lt_target'));
  };
  const saveOpt = async () => {   // remember the chosen settlement on the deal
    if (!isAdmin() || deal.closure_state !== 'awaiting_letter') return;
    try { await api('/deals/' + deal.id + '/closure', { method: 'POST', body: { option: v('lt_opt'), note: v('lt_target') } });
      deal.closure_option = v('lt_opt'); deal.closure_note = v('lt_target'); } catch {}
  };
  document.getElementById('lt_opt').onchange = () => { build(); saveOpt(); };
  document.getElementById('lt_target').onchange = () => { build(); saveOpt(); };
  document.getElementById('lt_target').oninput = build;
  document.getElementById('lt_lang').onchange = build;
  document.getElementById('lt_close').onclick = () => { close(); if (State.route.name === 'deal') renderDeal(); };
  document.getElementById('lt_copy').onclick = async () => {
    const ta = document.getElementById('lt_text'); ta.select();
    try { await navigator.clipboard.writeText(ta.value); } catch { document.execCommand('copy'); }
    ok('Letter copied.');
  };
  build();
}

function lifecycleAction(id, action, prompt) {
  const close = openModal(action[0].toUpperCase() + action.slice(1) + ' deal', `<p>${esc(prompt)}</p>`,
    `<button class="btn" id="l_no">Cancel</button><button class="btn primary" id="l_yes">${action[0].toUpperCase() + action.slice(1)}</button>`);
  document.getElementById('l_no').onclick = close;
  document.getElementById('l_yes').onclick = async () => {
    try { await api('/deals/' + id + '/' + action, { method: 'POST' }); close(); ok('Done.'); go('deal', { id }); }
    catch (e) { err(e.message); close(); }
  };
}

/* ================= APPROVALS ================= */
async function renderApprovals() {
  let rows;
  try { rows = await api('/approvals'); } catch (e) { return err(e.message); }
  State._pendingCount = rows.length;
  const body = rows.length ? rows.map(approvalCard).join('') :
    `<div class="empty"><h3>Nothing awaiting approval</h3><p>Submissions from office workers will appear here.</p></div>`;
  shell('Approvals', body);
  document.querySelectorAll('[data-approve]').forEach((b) => (b.onclick = () => resolveApproval(b.dataset.approve, true)));
  document.querySelectorAll('[data-reject]').forEach((b) => (b.onclick = () => resolveApproval(b.dataset.reject, false)));
  document.querySelectorAll('[data-open-deal]').forEach((b) => (b.onclick = () => go('deal', { id: Number(b.dataset.openDeal) })));
}
function approvalCard(a) {
  const s = a.summary;
  const money0 = (n) => money(n || 0);
  const kindBase = { customer_payment: 'Client payment', supplier_payment: 'Supplier payment', supplier_invoice: 'Delivery' }[a.entity_type] || a.entity_type;
  const kind = a.action === 'edit' ? `${kindBase} correction` : a.action === 'void' ? `${kindBase} void request` : `New ${kindBase.toLowerCase()}`;
  const fieldName = { invoice_number: 'Delivery invoice', delivery_date: 'Delivery date', amount: 'Proforma value', quantity: 'Quantity', notes: 'Notes' };
  const fmtField = (k, val) => (k === 'amount' ? money0(val) : k === 'delivery_date' ? fdate(val) : esc(val === '' || val == null ? '—' : val));
  const details = a.action === 'edit'
    ? `${row('Delivery', esc(s.invoice_number || ''))}${Object.keys(s.changes || {}).map((k) =>
        row(fieldName[k] || k, `<span class="was">${fmtField(k, (s.before || {})[k])}</span> → <b>${fmtField(k, s.changes[k])}</b>`)).join('')}`
    : a.action === 'void'
    ? `${row('Delivery', esc(s.invoice_number || ''))}${row('Proforma value', money0(s.amount))}${row('Reason', esc(s.reason || ''))}`
    : a.entity_type === 'supplier_invoice' && s.delivery
    ? `${row('Delivery invoice', esc(s.invoice_number))}${row('Proforma value delivered', money0(s.proforma_allocated != null ? s.proforma_allocated : s.amount))}`
    : a.entity_type === 'customer_payment'
    ? `${row('Amount', money0(s.amount))}${row('Applied', money0(s.applied))}${row('Our 4%', money0(s.kept))}${row('Supplier 96%', money0(s.reserved))}${s.overpayment > 0 ? row('Overpayment', money0(s.overpayment)) : ''}`
    : a.entity_type === 'supplier_invoice'
      ? `${row('Invoice #', esc(s.invoice_number))}${row('Invoice total', money0(s.amount))}${row('Proforma allocated', money0(s.proforma_allocated))}${row('Prepay credit', money0(s.prepay_credit_applied))}${row('Sales value', money0(s.customer_sales_value))}`
      : `${row('Amount', money0(s.amount))}${row('Type', s.is_prepayment ? 'Prepayment' : 'Invoice payment')}`;
  const docs = a.documents && a.documents.length
    ? a.documents.map((doc) => `<a class="tag" href="/api/documents/${doc.id}/file" target="_blank">${esc(doc.original_name)}</a>`).join(' ')
    : '<span class="meta">No document attached</span>';
  return card(`${kind} · ${esc(a.deal_ref)}`, `
    <div class="parties muted" style="margin-bottom:10px">${esc(a.deal_title)} — ${esc(a.customer_name)} → ${esc(a.supplier_name)}</div>
    <div class="rowset">
      ${details}
      ${row('Date', fdate(s.date))}
      ${row('Requested by', esc(a.requested_by_name))}
    </div>
    <div style="margin-top:10px">${docs}</div>
    <div class="btn-row" style="margin-top:14px">
      <button class="btn primary" data-approve="${a.id}">Approve</button>
      <button class="btn danger" data-reject="${a.id}">Reject</button>
      <button class="btn" data-open-deal="${a.deal_id}">Open deal</button>
    </div>`);
}
async function resolveApproval(id, approve) {
  try { await api('/approvals/' + id + '/' + (approve ? 'approve' : 'reject'), { method: 'POST' }); ok(approve ? 'Approved.' : 'Rejected.'); renderApprovals(); }
  catch (e) { err(e.message); }
}

/* ================= USERS ================= */
async function renderUsers() {
  let users;
  try { users = await api('/users'); } catch (e) { return err(e.message); }
  const rows = users.map((u) => `
    <tr>
      <td data-label="Name">${esc(u.name)}</td>
      <td data-label="Username">${esc(u.username)}</td>
      <td data-label="Role">
        <select data-role="${u.id}">
          ${['admin', 'office', 'visitor'].map((r) => `<option ${u.role === r ? 'selected' : ''}>${r}</option>`).join('')}
        </select>
      </td>
      <td data-label="Status"><span class="pill ${u.active ? 'green' : 'gray'}">${u.active ? 'active' : 'disabled'}</span></td>
      <td class="num" data-label="">
        <button class="btn sm" data-toggle="${u.id}:${u.active ? 0 : 1}">${u.active ? 'Disable' : 'Enable'}</button>
        <button class="btn sm" data-pw="${u.id}">Reset password</button>
      </td>
    </tr>`).join('');
  shell('User access', card('Users', `
    <div class="alert info" style="margin-bottom:14px">Passwords are stored encrypted and can never be shown — not even to administrators. To give someone access, use <b>Reset password</b>: you'll see and can copy the new password at that moment.</div>
    <table class="grid"><thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table>`,
    `<button class="btn sm primary" id="adduser">Add user</button>`)
    + card('Activity log', `<div id="audit-global"><div class="meta">Loading…</div></div>`));
  document.getElementById('adduser').onclick = addUserModal;
  document.querySelectorAll('[data-role]').forEach((sel) => (sel.onchange = async () => {
    try { await api('/users/' + sel.dataset.role, { method: 'PATCH', body: { role: sel.value } }); ok('Role updated.'); loadAuditLog(); }
    catch (e) { err(e.message); }
  }));
  document.querySelectorAll('[data-toggle]').forEach((b) => (b.onclick = async () => {
    const [id, active] = b.dataset.toggle.split(':');
    try { await api('/users/' + id, { method: 'PATCH', body: { active: Number(active) } }); renderUsers(); } catch (e) { err(e.message); }
  }));
  document.querySelectorAll('[data-pw]').forEach((b) => (b.onclick = () => resetPwModal(b.dataset.pw)));
  loadAuditLog();
}

async function loadAuditLog() {
  const box = document.getElementById('audit-global');
  if (!box) return;
  try {
    const rows = await api('/audit/recent?limit=150');
    if (!rows.length) { box.innerHTML = '<div class="meta">No activity yet.</div>'; return; }
    const pretty = (a) => {
      let extra = '';
      try { const s = JSON.parse(a.detail || '{}'); if (s.amount) extra = money(s.amount); if (s.ref) extra = s.ref; if (s.name) extra = s.name; if (s.reason) extra = s.reason; } catch {}
      return extra;
    };
    box.innerHTML = `<table class="grid"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Deal</th><th>Details</th></tr></thead><tbody>${
      rows.map((a) => `<tr>
        <td data-label="When" class="meta">${esc(String(a.created_at).replace('T', ' ').slice(0, 16))}</td>
        <td data-label="Who">${esc(a.actor_name || '—')}</td>
        <td data-label="Action">${esc(String(a.action).replace(/_/g, ' '))}</td>
        <td data-label="Deal">${a.deal_ref ? esc(a.deal_ref) : '—'}</td>
        <td data-label="Details" class="meta">${esc(pretty(a))}</td>
      </tr>`).join('')
    }</tbody></table>`;
  } catch (e) { box.innerHTML = '<div class="meta">Could not load the log.</div>'; }
}

/* password field with show/generate controls */
function pwField(id) {
  return `<div class="field"><label>Password</label>
    <div class="pw-row">
      <input id="${id}" type="text" autocomplete="new-password" />
      <button type="button" class="btn sm" data-gen="${id}">Generate</button>
    </div>
    <div class="hint">Shown in clear text so you can copy it. It will be encrypted on save and cannot be viewed again.</div></div>`;
}
function wireGen() {
  document.querySelectorAll('[data-gen]').forEach((b) => (b.onclick = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    let p = ''; for (let i = 0; i < 14; i++) p += chars[Math.floor(Math.random() * chars.length)];
    document.getElementById(b.dataset.gen).value = p;
  }));
}
function addUserModal() {
  const body = `
    <div class="field"><label>Full name</label><input id="au_name" /></div>
    <div class="field"><label>Username</label><input id="au_user" /></div>
    ${pwField('au_pw')}
    <div class="field"><label>Role</label><select id="au_role"><option value="office">Office worker</option><option value="admin">Administrator</option><option value="visitor">Visitor</option></select></div>
    <div id="au_err" class="alert err hidden"></div>`;
  const close = openModal('Add user', body, `<button class="btn" id="au_cancel">Cancel</button><button class="btn primary" id="au_save">Create user</button>`);
  wireGen();
  document.getElementById('au_cancel').onclick = close;
  document.getElementById('au_save').onclick = async () => {
    try { await api('/users', { method: 'POST', body: { name: v('au_name'), username: v('au_user'), password: v('au_pw'), role: v('au_role') } }); close(); ok('User created.'); renderUsers(); }
    catch (e) { showErr('au_err', e.message); }
  };
}
function resetPwModal(id) {
  const body = `${pwField('rp_pw')}<div id="rp_err" class="alert err hidden"></div>`;
  const close = openModal('Reset password', body, `<button class="btn" id="rp_cancel">Cancel</button><button class="btn primary" id="rp_save">Set password</button>`);
  wireGen();
  document.getElementById('rp_cancel').onclick = close;
  document.getElementById('rp_save').onclick = async () => {
    try { await api('/users/' + id, { method: 'PATCH', body: { password: v('rp_pw') } }); close(); ok('Password set. Copy it now — it cannot be shown again.'); }
    catch (e) { showErr('rp_err', e.message); }
  };
}

/* ================= ARCHIVE ================= */
async function renderArchive() {
  let data;
  try { data = await api('/deals?scope=archive'); } catch (e) { return err(e.message); }
  const body = data.deals.length ? `
    <table class="grid"><thead><tr><th>Reference</th><th>Title</th><th>Customer</th><th>Status</th><th></th></tr></thead>
    <tbody>${data.deals.map((d) => `
      <tr>
        <td data-label="Reference">${esc(d.ref)}</td>
        <td data-label="Title">${esc(d.title)}</td>
        <td data-label="Customer">${esc(d.customer_name)}</td>
        <td data-label="Status"><span class="pill ${d.status === 'deleted' ? 'red' : 'gray'}">${esc(d.status)}</span></td>
        <td class="num" data-label="">
          <button class="btn sm" data-open="${d.id}">View</button>
          ${isAdmin() && d.status === 'archived' ? `<button class="btn sm" data-reopen="${d.id}">Reopen</button><button class="btn sm danger" data-del="${d.id}">Delete</button>` : ''}
          ${isAdmin() && d.status === 'deleted' ? `<button class="btn sm danger" data-purge="${d.id}:${esc(d.ref)}">Permanently delete</button>` : ''}
        </td>
      </tr>`).join('')}</tbody></table>` :
    `<div class="empty"><h3>Archive is empty</h3><p>Archived and deleted deals appear here.</p></div>`;
  shell('Archive', card('Archived & deleted deals', body));
  document.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => go('deal', { id: Number(b.dataset.open) })));
  document.querySelectorAll('[data-reopen]').forEach((b) => (b.onclick = () => lifecycleAction(Number(b.dataset.reopen), 'reopen', 'Reopen this archived deal?')));
  document.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
    try { await api('/deals/' + b.dataset.del + '/delete', { method: 'POST' }); ok('Moved to deleted.'); renderArchive(); } catch (e) { err(e.message); }
  }));
  document.querySelectorAll('[data-purge]').forEach((b) => (b.onclick = () => {
    const [id, ref] = b.dataset.purge.split(':'); purgeModal(id, ref);
  }));
}
function purgeModal(id, ref) {
  const body = `<div class="alert err">This permanently removes the deal. This cannot be undone.</div>
    <div class="field"><label>Type the reference <b>${esc(ref)}</b> to confirm</label><input id="pg_ref" autofocus /></div>
    <div id="pg_err" class="alert err hidden"></div>`;
  const close = openModal('Permanently delete', body, `<button class="btn" id="pg_cancel">Cancel</button><button class="btn danger" id="pg_go">Permanently delete</button>`);
  document.getElementById('pg_cancel').onclick = close;
  document.getElementById('pg_go').onclick = async () => {
    try { await api('/deals/' + id + '/purge', { method: 'POST', body: { confirm: v('pg_ref') } }); close(); ok('Permanently deleted.'); renderArchive(); }
    catch (e) { showErr('pg_err', e.message); }
  };
}

/* ================= DEAL DETAILS (name, parties, invoice numbers) ================= */
function invoiceNumbers(d) {
  const p = (d.proforma_number || '').trim(), i = (d.invoice_number || '').trim();
  if (!p && !i) return isAdmin() ? `<div class="inv-nums empty">No invoice numbers yet — use ✎ to add them</div>` : '';
  return `<div class="inv-nums">${p ? `<span title="Supplier proforma number"><em>Proforma</em> ${esc(p)}</span>` : ''}${i ? `<span title="Our invoice number to the client"><em>Invoice</em> ${esc(i)}</span>` : ''}</div>`;
}
/* Edit what a deal is called — allowed any time, also on completed deals. */
async function dealDetailsModal(id, after) {
  let d;
  try { d = await api('/deals/' + id); } catch (e) { return err(e.message); }
  const deal = d.deal;
  const body = `
    <div class="form-row">
      <div class="field"><label>Deal reference</label><input id="dd_ref" value="${esc(deal.ref)}" /></div>
      <div class="field"><label>Deal name</label><input id="dd_title" value="${esc(deal.title)}" /></div>
    </div>
    <div class="form-row">
      <div class="field"><label>Supplier proforma number</label><input id="dd_pno" value="${esc(deal.proforma_number || '')}" placeholder="e.g. PMS-PF-2026-041" /></div>
      <div class="field"><label>Our invoice number to the client</label><input id="dd_ino" value="${esc(deal.invoice_number || '')}" placeholder="e.g. EP-INV-2026-017" /></div>
    </div>
    <div class="form-row">
      <div class="field"><label>Client</label><input id="dd_cust" value="${esc(deal.customer_name)}" /></div>
      <div class="field"><label>Supplier</label><input id="dd_supp" value="${esc(deal.supplier_name)}" /></div>
    </div>
    <div class="field"><label>Notes</label><textarea id="dd_notes">${esc(deal.notes || '')}</textarea></div>
    ${deal.status === 'active' ? `<div class="hint">Need to change the amounts? <a href="#" id="dd_amounts">Edit amounts</a></div>`
      : `<div class="hint">This deal is ${esc(deal.status)} — names and numbers can still be changed; amounts are locked.</div>`}
    <div id="dd_err" class="alert err hidden"></div>`;
  const close = openModal('Edit deal details — ' + deal.ref, body,
    `<button class="btn" id="dd_no">Cancel</button><button class="btn primary" id="dd_yes">Save details</button>`, { wide: true });
  document.getElementById('dd_no').onclick = close;
  const am = document.getElementById('dd_amounts');
  if (am) am.onclick = (e) => { e.preventDefault(); close(); editDealModal(deal, d.computed); };
  document.getElementById('dd_yes').onclick = async () => {
    const payload = { ref: v('dd_ref'), title: v('dd_title'), proforma_number: v('dd_pno'), invoice_number: v('dd_ino'),
      customer_name: v('dd_cust'), supplier_name: v('dd_supp'), notes: document.getElementById('dd_notes').value };
    try { await api('/deals/' + id, { method: 'PATCH', body: payload }); close(); ok('Deal details saved.'); if (after) after(); else render(); }
    catch (e) { showErr('dd_err', e.message); }
  };
}
/* the ✎ on a card edits details without opening the deal */
function wireCardEdits() {
  document.querySelectorAll('[data-editdeal]').forEach((b) => {
    b.onclick = (e) => { e.stopPropagation(); dealDetailsModal(Number(b.dataset.editdeal)); };
    b.onkeydown = (e) => e.stopPropagation();
  });
}
/* Deals are listed in the order they were added (1 → 7), or reversed. */
function getSortDir() { try { return localStorage.getItem('ep-sort') === 'desc' ? 'desc' : 'asc'; } catch { return 'asc'; } }
function byAdded(list) {
  const dir = getSortDir();
  return (list || []).slice().sort((a, b) => (dir === 'asc' ? a.id - b.id : b.id - a.id));
}
function listTools(searchId) {
  const dir = getSortDir();
  return `<div class="list-tools">${dealSearchBox(searchId)}
    <div class="sort-toggle" role="group" aria-label="Order of deals"><span>Order</span>
      <button type="button" data-sort="asc" class="${dir === 'asc' ? 'on' : ''}" aria-pressed="${dir === 'asc'}">Oldest first</button>
      <button type="button" data-sort="desc" class="${dir === 'desc' ? 'on' : ''}" aria-pressed="${dir === 'desc'}">Newest first</button>
    </div></div>`;
}
function wireSortToggle() {
  document.querySelectorAll('[data-sort]').forEach((b) => (b.onclick = () => {
    try { localStorage.setItem('ep-sort', b.dataset.sort); } catch {}
    render();
  }));
}
/* filter the visible cards by reference, name, parties or invoice number */
function dealSearchBox(id) {
  return `<div class="deal-search"><input id="${id}" type="search" placeholder="Search by name, reference, client, supplier or invoice number" aria-label="Search deals" /></div>`;
}
function wireDealSearch(inputId, deals) {
  const box = document.getElementById(inputId);
  if (!box) return;
  const hay = {};
  deals.forEach((d) => { hay[d.id] = [d.ref, d.title, d.customer_name, d.supplier_name, d.proforma_number, d.invoice_number].join(' ').toLowerCase(); });
  box.oninput = () => {
    const q = box.value.trim().toLowerCase();
    let shown = 0;
    document.querySelectorAll('[data-deal],[data-flow]').forEach((c) => {
      const id = Number(c.dataset.deal || c.dataset.flow);
      const hit = !q || (hay[id] || '').includes(q);
      c.classList.toggle('hidden', !hit); if (hit) shown++;
    });
    const none = document.getElementById(inputId + '-none');
    if (none) none.classList.toggle('hidden', shown > 0);
  };
}

/* ================= COMPLETED DEALS ================= */
function closureBadge(d, cur) {
  if (d.closure_state === 'awaiting_letter') {
    const how = d.closure_option === 'transfer' ? 'to be transferred to other deals' : 'to be refunded to us';
    return `<div class="closure-badge open"><b>Completed — open balance ${money(d.closure_balance, cur)}</b>
      <span>The manufacturer holds this amount (${how}). Their balance letter must be attached.</span></div>`;
  }
  if (d.closure_state === 'closed' && Number(d.closure_balance) > 0.005)
    return `<div class="closure-badge done"><b>Closed with letter</b><span>Balance of ${money(d.closure_balance, cur)} confirmed by the manufacturer.</span></div>`;
  return '';
}
async function renderCompleted() {
  let data;
  try { data = await api('/deals'); } catch (e) { return err(e.message); }
  State._dealList = data.deals;
  const done = byAdded(data.deals.filter((d) => d.status === 'completed'));
  const waiting = done.filter((d) => d.closure_state === 'awaiting_letter');
  State._awaitingLetters = waiting.length;
  const openTotal = waiting.reduce((a, d) => a + Number(d.closure_balance || 0), 0);
  shell('Completed Deals', `
    <div class="stats">
      <div class="stat"><div class="label">Completed deals</div><div class="value">${done.length}</div></div>
      <div class="stat"><div class="label">Fully closed</div><div class="value green">${done.length - waiting.length}</div></div>
      <div class="stat"><div class="label">Waiting for manufacturer letter</div><div class="value ${waiting.length ? 'amber' : ''}">${waiting.length}</div></div>
      <div class="stat"><div class="label">Open balances held by manufacturers</div><div class="value tnum">${money(openTotal)}</div></div>
    </div>
    ${waiting.length ? `<div class="alert warn letter-alert">These deals are marked complete, but the manufacturer still holds money. Each one needs the manufacturer's balance letter attached before it is fully closed.</div>` : ''}
    ${done.length > 1 ? listTools('q-done') : ''}
    <div class="empty small hidden" id="q-done-none">No deal matches that search.</div>
    ${done.length ? `<div class="dcard-grid">${done.map(dealCard).join('')}</div>`
      : `<div class="empty"><h3>No completed deals yet</h3><p>Deals you mark complete appear here.</p></div>`}
  `);
  document.querySelectorAll('[data-deal]').forEach((c) => {
    c.onclick = () => go('deal', { id: Number(c.dataset.deal) });
    c.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); c.click(); } };
  });
  wireCardEdits();
  wireDealSearch('q-done', done);
  wireSortToggle();
}

/* ================= OVERVIEW — deal cards with mini flow diagrams ================= */
async function renderOverview() {
  let data;
  try { data = await api('/deals'); } catch (e) { return err(e.message); }
  State._dealList = data.deals;
  const cards = byAdded(data.deals).map((d) => `
    <div class="ovcard" data-flow="${d.id}" tabindex="0" role="button" aria-label="Open flows for ${esc(d.ref)}">
      <div class="dcard-top"><span class="dcard-ref">${esc(d.ref)}</span>
        <span class="dcard-top-r"><span class="pill ${d.status === 'active' ? 'blue' : 'green'}">${esc(d.status)}</span>
        ${isAdmin() ? `<button class="card-edit" type="button" data-editdeal="${d.id}" aria-label="Edit details of ${esc(d.ref)}" title="Edit name, parties and invoice numbers">✎</button>` : ''}</span></div>
      <div class="dcard-title">${esc(d.title)}</div>
      ${invoiceNumbers(d)}
      ${miniDiagram(d)}
      <div class="ov-stats">
        <div><span>Paid in</span><b class="green">${pct(d.invoice_total > 0 ? Math.min(100, d.computed.totalReceived / d.invoice_total * 100) : 0)}</b></div>
        <div><span>Delivered</span><b class="navy">${pct(d.computed.deliveryPct)}</b></div>
        <div><span>${isAdmin() ? 'Income' : '4% fee paid'}</span><b class="gold">${isAdmin() ? money(d.computed.incomeKept, d.currency) : money(d.computed.feePaid, d.currency)}</b></div>
      </div>
    </div>`).join('');
  const actions = isAdmin() && data.deals.length ? `<button class="btn primary" id="ov-report">Partner report</button>` : '';
  shell('Overview', `
    <p class="lead">Every deal as a picture: money flowing in and out, and goods delivered against the proforma. Click a card to see its flows in detail.</p>
    ${data.deals.length > 1 ? listTools('q-ov') : ''}
    <div class="empty small hidden" id="q-ov-none">No deal matches that search.</div>
    ${data.deals.length ? `<div class="dcard-grid">${cards}</div>` : `<div class="empty"><h3>No deals yet</h3></div>`}
  `, actions);
  document.querySelectorAll('[data-flow]').forEach((c) => {
    c.onclick = () => go('flow', { id: Number(c.dataset.flow) });
    c.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); c.click(); } };
  });
  const rb = document.getElementById('ov-report');
  if (rb) rb.onclick = () => partnerReportModal(data.deals);
  wireCardEdits();
  wireDealSearch('q-ov', data.deals);
  wireSortToggle();
}

/* tiny version of the flows for an overview card (native tooltips, so the
   whole card stays one click target) */
function miniDiagram(d) {
  const c = d.computed, cur = d.currency;
  const sm = (v) => shortMoney(v, cur);
  const nm = (t, n) => (t.length > n ? t.slice(0, n - 1) + '…' : t);
  const gp = Math.min(100, c.deliveryPct || 0);
  return `<svg class="mini-dg" viewBox="0 0 320 168" role="img" aria-label="Money and goods flow">
    <defs><marker id="mm${d.id}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="dg-ah-money"/></marker>
    <marker id="mg${d.id}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="dg-ah-goods"/></marker></defs>
    <text x="52" y="16" text-anchor="middle" class="mini-n">${esc(nm(d.customer_name, 13))}</text>
    <text x="160" y="16" text-anchor="middle" class="mini-n">Europa</text>
    <text x="268" y="16" text-anchor="middle" class="mini-n">${esc(nm(d.supplier_name, 13))}</text>
    <g><title>${esc(d.customer_name)} — paid ${money(c.totalReceived, cur)}</title><circle cx="52" cy="54" r="20" class="mini-c green"/><text x="52" y="59" text-anchor="middle" class="mini-l">C</text></g>
    <g><title>Europa Pharmaceutical</title><circle cx="160" cy="54" r="20" class="mini-c gold"/><text x="160" y="59" text-anchor="middle" class="mini-l">EP</text></g>
    <g><title>${esc(d.supplier_name)} — paid ${money(c.totalPaidToSupplier || 0, cur)}</title><circle cx="268" cy="54" r="20" class="mini-c navy"/><text x="268" y="59" text-anchor="middle" class="mini-l">S</text></g>
    <path d="M74,54 H136" class="dg-money mini" marker-end="url(#mm${d.id})"/>
    <path d="M182,54 H244" class="dg-money mini" marker-end="url(#mm${d.id})"/>
    <text x="105" y="44" text-anchor="middle" class="mini-a green">${esc(sm(c.totalReceived))}</text>
    <text x="213" y="44" text-anchor="middle" class="mini-a navy">${esc(sm(c.totalPaidToSupplier || 0))}</text>
    <path d="M268,76 V112 Q268,124 256,124 H64 Q52,124 52,112 V80" class="dg-goods mini" marker-end="url(#mg${d.id})"/>
    <text x="160" y="116" text-anchor="middle" class="mini-a goods">goods ${esc(sm(c.deliveredValue))}</text>
    <rect x="20" y="146" width="280" height="8" rx="4" class="dg-track"/>
    <rect x="20" y="146" width="${(280 * gp) / 100}" height="8" rx="4" class="mini-goodsfill"/>
  </svg>`;
}

/* ================= FLOW VIEW — one deal, flows only ================= */
async function renderFlow() {
  let d;
  try { d = await api('/deals/' + State.route.id); } catch (e) { return err(e.message); }
  State.cache.deal = d;
  State.cache.docs = {}; (d.documents || []).forEach((x) => { State.cache.docs[x.id] = { mime: x.mime, name: x.original_name }; });
  const deal = d.deal, c = d.computed, cur = deal.currency;
  const posted = (arr) => (arr || []).filter((x) => x.status === 'posted');
  const events = [
    ...posted(d.customerPayments).map((p) => ({ date: p.date, kind: 'in', text: `Payment in from ${deal.customer_name}`, amt: Number(p.amount_received) })),
    ...posted(d.supplierPayments).map((p) => ({ date: p.date, kind: 'out', text: `Payment out to ${deal.supplier_name}`, amt: Number(p.amount) })),
    ...posted(d.supplierInvoices).map((x) => ({ date: x.delivery_date || x.issue_date, kind: 'goods', text: `Delivery ${x.invoice_number}`, amt: Number(x.proforma_allocated) || 0 })),
  ].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  const last = (kind) => { const e = events.filter((x) => x.kind === kind); return e.length ? fdate(e[e.length - 1].date) : '—'; };
  const sign = { in: '+', out: '−', goods: '' };
  const label = { in: 'Money in', out: 'Money out', goods: 'Goods' };

  const actions = `
    <button class="btn" id="fl-back">← Overview</button>
    <button class="btn" id="fl-open">Open full deal</button>
    ${isAdmin() ? `<button class="btn primary" id="fl-report">Partner report</button>` : ''}`;
  shell(deal.ref, `
    <div class="deal-head"><h2>${esc(deal.title)}</h2>
      <span class="pill ${deal.status === 'active' ? 'blue' : deal.status === 'completed' ? 'green' : 'gray'}">${esc(deal.status)}</span></div>
    <div class="parties muted" style="margin-bottom:6px">${esc(deal.customer_name)} &nbsp;·&nbsp; ${esc(deal.supplier_name)}</div>
    ${invoiceNumbers(deal)}
    <div class="info-strip" style="margin-top:12px">
      <div><span>Deal value</span><b>${money(deal.invoice_total, cur)}</b></div>
      <div><span>Supplier proforma</span><b>${money(deal.proforma_total, cur)}</b></div>
      <div><span>Opened</span><b>${fdate(deal.created_at)}</b></div>
      <div><span>Last payment in</span><b>${last('in')}</b></div>
      <div><span>Last payment out</span><b>${last('out')}</b></div>
      <div><span>Last delivery</span><b>${last('goods')}</b></div>
      <div><span>Next</span><b class="next">${esc(d.nextAction.label)}</b></div>
    </div>
    ${dealDiagram(d)}
    ${goodsDiagram(d)}
    ${card('Timeline', events.length ? `<div class="tl">${events.map((e) => `
      <div class="tl-row ${e.kind}">
        <div class="tl-date">${fdate(e.date)}</div>
        <div class="tl-dot"></div>
        <div class="tl-text"><span class="tl-kind">${label[e.kind]}</span> ${esc(e.text)}</div>
        <div class="tl-amt">${sign[e.kind]} ${money(e.amt, cur)}</div>
      </div>`).join('')}</div>` : '<div class="empty small">Nothing has happened on this deal yet.</div>')}
  `, actions);
  document.getElementById('fl-back').onclick = () => go('overview');
  document.getElementById('fl-open').onclick = () => go('deal', { id: deal.id });
  const rb = document.getElementById('fl-report');
  if (rb) rb.onclick = () => partnerReportModal([{ id: deal.id, ref: deal.ref, title: deal.title, customer_name: deal.customer_name }], [deal.id]);
  wireDiagram();
}

/* ================= PARTNER REPORT (deterministic, Russian) =================
   Builds the per-deal summary sent to the partner, from live deal data only.
   No AI involved: the same data always produces the same text. */
const RU_MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const RU_ORD = ['Первая', 'Вторая', 'Третья', 'Четвёртая', 'Пятая', 'Шестая', 'Седьмая', 'Восьмая', 'Девятая', 'Десятая'];
const RU_WORD = ['ноль', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять', 'десять'];
function ruNum(v) {
  const cents = Math.round(Math.abs(Number(v) || 0) * 100);
  const int = Math.floor(cents / 100), dec = cents % 100;
  const s = String(int).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
  return ((Number(v) || 0) < 0 ? '−' : '') + s + (dec ? ',' + String(dec).padStart(2, '0') : '');
}
function ruDate(s) {
  if (!s) return 'без даты';
  const [y, mo, d] = String(s).slice(0, 10).split('-').map(Number);
  return `${d} ${RU_MONTHS[mo - 1]}` + (y !== new Date().getFullYear() ? ` ${y} г.` : '');
}
function ruPlural(n, one, few, many) {
  const a = n % 10, b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 10 || b >= 20)) return few;
  return many;
}
const ruCount = (n) => (n <= 10 ? RU_WORD[n] : String(n));
const ruOrd = (k) => RU_ORD[k - 1] || `${k}-я`;

/* Which client payment each supplier payment forwarded. Uses the explicit link
   when it was recorded; otherwise the latest client payment on or before the
   supplier payment's date (that is how payments are normally forwarded). */
function forwardingByPayment(cps, sps) {
  const fwd = new Map(cps.map((p) => [p.id, 0]));
  let unlinked = 0;
  for (const sp of sps) {
    let target = sp.funded_by && fwd.has(sp.funded_by) ? sp.funded_by : null;
    if (!target) {
      const before = cps.filter((p) => String(p.date || '') <= String(sp.date || ''));
      target = before.length ? before[before.length - 1].id : null;
    }
    if (target) fwd.set(target, fwd.get(target) + Number(sp.amount || 0));
    else unlinked += Number(sp.amount || 0);
  }
  return { fwd, unlinked };
}

function partnerReportSection(n, d, opts) {
  const deal = d.deal, c = d.computed;
  const byDate = (k) => (a, b) => String(a[k] || '').localeCompare(String(b[k] || '')) || a.id - b.id;
  const posted = (arr) => (arr || []).filter((x) => x.status === 'posted');
  const cps = posted(d.customerPayments).sort(byDate('date'));
  const sps = posted(d.supplierPayments).sort(byDate('date'));
  const dels = posted(d.supplierInvoices).map((x) => ({ ...x, _d: x.delivery_date || x.issue_date })).sort(byDate('_d'));
  const label = (opts.supplier || 'Латвия').trim();
  const latvia = /^латви/i.test(label);
  const to = latvia ? 'поставщику (Латвия)' : `поставщику (${label})`;
  const L = [];

  L.push(`${n} Сделка${opts.showRef ? ` (${deal.ref}${deal.invoice_number ? `, инвойс № ${deal.invoice_number}` : ''})` : ''}`);
  L.push('');
  L.push(`Инвойс со стороны Europa Pharmaceuticals вам был выслан на ${ruNum(deal.invoice_total)} €. ` +
    (latvia ? `Латыши нам высылали на ${ruNum(deal.proforma_total)} €.` : `Поставщик (${label}) выслал нам инвойс на ${ruNum(deal.proforma_total)} €.`));
  L.push('');
  if (!dels.length) L.push('Поставок пока не было.');
  else {
    L.push(dels.length === 1 ? 'Всего была одна поставка:' : `Всего было ${ruCount(dels.length)} ${ruPlural(dels.length, 'поставка', 'поставки', 'поставок')}:`);
    L.push('');
    dels.forEach((x, i) => L.push(`${i + 1}. ${ruDate(x._d)} — на сумму ${ruNum(x.proforma_allocated || 0)} €`));
  }
  L.push('');
  if (c.deliveryOutstanding > 0.005) L.push(`Остается открытый баланс по поставкам: ${ruNum(c.deliveryOutstanding)} €.`);
  else if (c.overDelivery > 0.005) L.push(`Поставлено сверх проформы на ${ruNum(c.overDelivery)} €.`);
  else L.push('Все товары по проформе поставлены.');
  if (opts.askClose) L.push('Прошу подтвердить, закрыта ли сделка. На основании этого нам нужно написать письма насчет открытых балансов.');
  L.push('');
  L.push('С финансовой точки зрения:');
  const { fwd, unlinked } = forwardingByPayment(cps, sps);
  if (!cps.length) L.push('С вашей стороны оплат пока не было.');
  else {
    L.push(cps.length === 1 ? 'С вашей стороны была сделана одна оплата:' : `С вашей стороны было сделано ${ruCount(cps.length)} ${ruPlural(cps.length, 'оплата', 'оплаты', 'оплат')}:`);
    L.push('');
    cps.forEach((p, i) => {
      const amt = Number(p.amount_received) || 0, sent = fwd.get(p.id) || 0;
      const tail = sent >= amt - 0.005 ? `которая полностью была выслана ${to}.`
        : sent > 0.005 ? `из которых ${to} было выслано ${ruNum(sent)} €.`
          : `из нее ${to} пока ничего не было выслано.`;
      L.push(`${i + 1}. ${cps.length === 1 ? 'Оплата' : ruOrd(i + 1)} — ${ruNum(amt)} €, ${tail}`);
    });
  }
  if (unlinked > 0.005) { L.push(''); L.push(`Кроме того, ${to} было выслано ${ruNum(unlinked)} € до получения оплаты с вашей стороны.`); }

  const paidOut = sps.reduce((a, p) => a + Number(p.amount || 0), 0);
  const weOwe = Math.max(0, Number(deal.proforma_total) - paidOut);
  const weOver = Math.max(0, paidOut - Number(deal.proforma_total));
  const theyOwe = c.customerBalance || 0;
  const theyOver = c.customerOverpayment || 0;
  if (weOwe > 0.005 || theyOwe > 0.005 || weOver > 0.005 || theyOver > 0.005) {
    L.push('');
    L.push('Открытый баланс:');
    if (weOwe > 0.005) L.push(`${ruNum(weOwe)} € — у нас к ${latvia ? 'латышам' : `поставщику (${label})`}.`);
    if (weOver > 0.005) L.push(`${ruNum(weOver)} € — наша переплата ${latvia ? 'латышам' : `поставщику (${label})`}.`);
    if (theyOwe > 0.005) L.push(`${ruNum(theyOwe)} € — у вас к нам.`);
    if (theyOver > 0.005) L.push(`${ruNum(theyOver)} € — ваша переплата.`);
  }
  return L.join('\n');
}

async function partnerReportModal(deals, preselect) {
  const sel = new Set(preselect || deals.filter((d) => d.status !== 'completed').map((d) => d.id));
  const cache = {};
  const body = `
    <div class="rep-opts">
      <div class="field"><label>Deals to include</label>
        <div class="rep-list">${deals.slice().sort((a, b) => a.id - b.id).map((d) => `
          <label class="rep-item"><input type="checkbox" data-rdeal="${d.id}" ${sel.has(d.id) ? 'checked' : ''}/>
            <span><b>${esc(d.ref)}</b> — ${esc(d.title)} <span class="meta">· ${esc(d.customer_name)}</span></span></label>`).join('')}</div></div>
      <div class="form-row">
        <div class="field"><label>Supplier in the text</label><input id="rp_sup" value="Латвия" />
          <div class="hint">"Латвия" gives "Латыши нам высылали…"; any other name is written out.</div></div>
        <div class="field"><label>Options</label>
          <label class="rep-item"><input type="checkbox" id="rp_ref" checked/> <span>Show deal reference</span></label>
          <label class="rep-item"><input type="checkbox" id="rp_close"/> <span>Ask partner to confirm the deal is closed</span></label></div>
      </div>
    </div>
    <div class="field"><label>Report — edit freely before copying</label>
      <textarea id="rp_text" class="rep-text" spellcheck="false">Preparing…</textarea></div>
    <div id="rp_err" class="alert err hidden"></div>`;
  const close = openModal('Partner report', body,
    `<button class="btn" id="rp_cancel">Close</button><button class="btn primary" id="rp_copy">Copy text</button>`, { wide: true });
  const ta = document.getElementById('rp_text');
  const build = async () => {
    const ids = [...document.querySelectorAll('[data-rdeal]')].filter((x) => x.checked).map((x) => Number(x.dataset.rdeal)).sort((a, b) => a - b); // order deals were opened
    if (!ids.length) { ta.value = 'Select at least one deal.'; return; }
    try {
      for (const id of ids) if (!cache[id]) cache[id] = await api('/deals/' + id);
      const opts = { supplier: v('rp_sup'), showRef: document.getElementById('rp_ref').checked, askClose: document.getElementById('rp_close').checked };
      ta.value = ids.map((id, i) => partnerReportSection(i + 1, cache[id], opts)).join('\n\n\n');
    } catch (e) { showErr('rp_err', e.message); }
  };
  document.querySelectorAll('[data-rdeal], #rp_ref, #rp_close').forEach((x) => (x.onchange = build));
  document.getElementById('rp_sup').oninput = build;
  document.getElementById('rp_cancel').onclick = close;
  document.getElementById('rp_copy').onclick = async () => {
    ta.select();
    try { await navigator.clipboard.writeText(ta.value); ok('Report copied.'); }
    catch { document.execCommand('copy'); ok('Report copied.'); }
  };
  build();
}

/* ================= NOTIFICATIONS ================= */
async function refreshBell() {
  try {
    const n = await api('/notifications');
    State._notif = n;
    const dot = document.getElementById('bell-dot');
    if (dot) dot.classList.toggle('hidden', !n.unread);
  } catch {}
}
async function notificationsModal() {
  let n = State._notif;
  try { n = await api('/notifications'); } catch {}
  const items = (n && n.items) || [];
  const body = items.length ? `<div class="notif-list">${items.map((it) => `
    <div class="notif ${it.read ? '' : 'unread'}">
      <div class="notif-k ${esc(it.kind)}"></div>
      <div>
        <div class="notif-t">${esc(it.title)}${it.deal_ref ? ` <span class="tag">${esc(it.deal_ref)}</span>` : ''}</div>
        ${it.body ? `<div class="meta">${esc(it.body)}</div>` : ''}
        <div class="meta">${esc(String(it.created_at).replace('T', ' ').slice(0, 16))}</div>
      </div>
    </div>`).join('')}</div>` : '<div class="empty small">Nothing new.</div>';
  const close = openModal('Notifications', body, `<button class="btn" id="nt_close">Close</button><button class="btn primary" id="nt_read">Mark all read</button>`);
  document.getElementById('nt_close').onclick = close;
  document.getElementById('nt_read').onclick = async () => {
    try { await api('/notifications/read', { method: 'POST' }); } catch {}
    close(); refreshBell();
  };
}

/* ================= TOTAL FINANCES ================= */
async function renderReports() {
  let r;
  try { r = await api('/reports'); } catch (e) { return err(e.message); }
  const t = r.totals;
  const maxM = Math.max(1, ...r.months.map((m) => Math.max(m.in, m.out)));
  const monthBars = r.months.length ? r.months.map((m) => `
    <div class="mrow">
      <div class="mlabel">${esc(m.m)}</div>
      <div class="mbars">
        <div class="mbar in" style="width:${Math.round(m.in / maxM * 100)}%" title="In ${money(m.in)}"></div>
        <div class="mbar out" style="width:${Math.round(m.out / maxM * 100)}%" title="Out ${money(m.out)}"></div>
      </div>
      <div class="mvals"><span class="green tnum">${money(m.in)}</span> <span class="muted">/</span> <span class="blue tnum">${money(m.out)}</span></div>
    </div>`).join('') : '<div class="meta">No payments recorded yet.</div>';

  const dealRows = byAdded(r.deals).map((d) => `
    <tr>
      <td data-label="Deal"><a href="#" data-open-deal="${d.id}">${esc(d.ref)}</a> — ${esc(d.title)}</td>
      <td class="num" data-label="Received">${money(d.received, d.currency)}</td>
      <td class="num" data-label="Paid">${money(d.paid, d.currency)}</td>
      ${isAdmin() ? `<td class="num" data-label="Income">${money(d.income, d.currency)}</td>` : ''}
      <td class="num" data-label="Delivered">${money(d.delivered, d.currency)}</td>
      <td data-label="Status"><span class="pill ${d.status === 'active' ? 'blue' : 'green'}">${esc(d.status)}</span></td>
    </tr>`).join('');

  shell('Total Finances', `
    <div class="stats">
      <div class="stat"><div class="label">Money in (from clients)</div><div class="value green tnum">${money(t.moneyIn)}</div></div>
      <div class="stat"><div class="label">Money out (to suppliers)</div><div class="value blue tnum">${money(t.moneyOut)}</div></div>
      ${isAdmin() ? `<div class="stat"><div class="label">Net cash held now</div><div class="value gold tnum">${money(t.netCashHeld)}</div></div>`
        : `<div class="stat"><div class="label">Total delivered</div><div class="value tnum">${money(t.delivered)}</div></div>`}
      ${isAdmin()
        ? `<div class="stat"><div class="label">Our income kept</div><div class="value gold tnum">${money(t.incomeKept)}</div><div class="stat-sub">of ${money(t.incomeExpected)} expected</div></div>`
        : `<div class="stat"><div class="label">Unpaid for delivered goods</div><div class="value tnum">${money(t.totalUnderpaidToDate || 0)}</div></div>`}
    </div>

    <div class="rep-grid">
      ${card('Highlights', `
        <div class="rowset">
          ${row('Deals (active / completed)', t.activeCount + ' / ' + t.completedCount)}
          ${row('Still to collect from clients', money(t.toCollect), t.toCollect > 0 ? 'amber' : 'green')}
          ${row('Still to pay suppliers', money(t.toPaySupplier), t.toPaySupplier > 0 ? 'amber' : 'green')}
          ${row('Total delivered (goods)', money(t.delivered), 'green')}
          ${r.biggest ? row('Biggest deal', esc(r.biggest.ref) + ' · ' + money(r.biggest.invoiceTotal, r.biggest.currency)) : ''}
          ${isAdmin() && r.topIncome ? row('Most profitable deal', esc(r.topIncome.ref) + ' · ' + money(r.topIncome.income, r.topIncome.currency)) : ''}
        </div>`)}
      ${card('Money in vs out by month', `<div class="mchart">${monthBars}</div>
        <div class="mlegend"><span class="green">■</span> In &nbsp; <span class="blue">■</span> Out</div>`)}
    </div>

    ${card('All deals', `<table class="grid">
      <thead><tr><th>Deal</th><th class="num">Received</th><th class="num">Paid</th>${isAdmin() ? '<th class="num">Income</th>' : ''}<th class="num">Delivered</th><th>Status</th></tr></thead>
      <tbody>${dealRows || '<tr><td colspan="6" class="muted small">No deals yet.</td></tr>'}</tbody></table>`)}
  `);
  document.querySelectorAll('[data-open-deal]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); go('deal', { id: Number(a.dataset.openDeal) }); }));
}

/* ================= ROUTER ================= */
function render() {
  if (!State.user) return renderLogin();
  const r = State.route.name;
  if (r === 'deals') return renderDeals();
  if (r === 'overview') return renderOverview();
  if (r === 'completed') return renderCompleted();
  if (r === 'flow') return renderFlow();
  if (r === 'reports') return renderReports();
  if (r === 'deal') return renderDeal();
  if (r === 'approvals') return isAdmin() ? renderApprovals() : go('deals');
  if (r === 'users') return isAdmin() ? renderUsers() : go('deals');
  if (r === 'archive') return renderArchive();
  return renderDeals();
}

/* ================= BOOT ================= */
/* ================= ZOOM =================
   Scales the main screen only (the sidebar keeps its size). Remembered per device.
   Default is 90%, a little smaller than the browser's normal size. */
const ZOOM_STEPS = [0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 1, 1.1, 1.25];
const ZOOM_DEFAULT = 0.9;
function getZoom() {
  try { const z = parseFloat(localStorage.getItem('ep-zoom-main')); if (ZOOM_STEPS.includes(z)) return z; } catch {}
  return ZOOM_DEFAULT;
}
function applyZoom(z) {
  const main = document.querySelector('.main');
  if (main) main.style.zoom = z === 1 ? '' : String(z);
  const lbl = document.getElementById('zm-reset');
  if (lbl) lbl.textContent = Math.round(z * 100) + '%';
}
function setZoom(z) {
  try { localStorage.setItem('ep-zoom-main', String(z)); } catch {}
  applyZoom(z);
}
function stepZoom(dir) {
  const i = ZOOM_STEPS.indexOf(getZoom());
  setZoom(ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, (i < 0 ? ZOOM_STEPS.indexOf(ZOOM_DEFAULT) : i) + dir))]);
}
document.addEventListener('keydown', (e) => {   // Alt + / Alt − / Alt 0 as shortcuts
  if (!e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.key === '=' || e.key === '+') { e.preventDefault(); stepZoom(1); }
  else if (e.key === '-') { e.preventDefault(); stepZoom(-1); }
  else if (e.key === '0') { e.preventDefault(); setZoom(ZOOM_DEFAULT); }
});

(async function boot() {
  try { State.user = await api('/me'); } catch { State.user = null; }
  render();
})();
