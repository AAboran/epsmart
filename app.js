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
          <button class="nav-item ${State.route.name === n ? 'active' : ''}" data-nav="${n}">
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
          <button class="bell" id="bell" aria-label="Notifications">🔔<span class="bell-dot hidden" id="bell-dot"></span></button>
          ${actionsHtml}
        </div>
        <div class="content" id="content">${bodyHtml}</div>
      </div>
    </div>`;

  document.querySelectorAll('[data-nav]').forEach((b) => (b.onclick = () => go(b.dataset.nav)));
  document.getElementById('logout').onclick = async () => { await api('/logout', { method: 'POST' }); State.user = null; renderLogin(); };
  document.getElementById('bell').onclick = notificationsModal;
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
  const cards = data.deals.map(dealCard).join('');
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
    ${data.deals.length ? `<div class="deal-list">${cards}</div>` :
      `<div class="empty"><h3>No active deals yet</h3><p>${canWrite() ? 'Create your first deal to start tracking payments and deliveries.' : 'Deals will appear here once created.'}</p></div>`}
  `, actions);

  document.querySelectorAll('[data-deal]').forEach((c) => (c.onclick = () => go('deal', { id: Number(c.dataset.deal) })));
  const nd = document.getElementById('newdeal');
  if (nd) nd.onclick = newDealModal;
}

function dealCard(d) {
  const c = d.computed, cur = d.currency;
  const na = d.nextAction;
  const naClass = na.priority === 0 ? 'attn' : (na.code === 'complete_deal' ? 'done' : '');
  const paidToSupplier = (c.supplierInvoicePaid || 0) + (c.supplierPrepaySent || 0);
  const supplierOwed = c.supplierInvoicesGross > 0 ? c.supplierInvoicesGross : d.proforma_total;
  const recvPct = d.invoice_total > 0 ? Math.min(100, c.totalReceived / d.invoice_total * 100) : 0;
  const paidPct = supplierOwed > 0 ? Math.min(100, paidToSupplier / supplierOwed * 100) : 0;
  return `
    <div class="deal-card" data-deal="${d.id}" tabindex="0" role="button">
      <div class="dc-main">
        <div class="ref">${esc(d.ref)} · <span class="pill ${d.status === 'active' ? 'blue' : d.status === 'completed' ? 'green' : 'gray'}">${esc(d.status)}</span></div>
        <div class="title">${esc(d.title)}</div>
        <div class="parties">${esc(d.customer_name)} &nbsp;→&nbsp; ${esc(d.supplier_name)}</div>
        <div class="dc-bars">
          <div class="dc-bar">
            <div class="dc-bar-top"><span>Received from client</span><b class="green">${money(c.totalReceived, cur)}</b></div>
            <div class="progress"><span style="width:${recvPct}%"></span></div>
            ${c.customerBalance > 0.005 ? `<div class="meta">still to collect ${money(c.customerBalance, cur)}</div>` : `<div class="meta green">fully collected</div>`}
          </div>
          <div class="dc-bar">
            <div class="dc-bar-top"><span>Paid to supplier</span><b class="blue">${money(paidToSupplier, cur)}</b></div>
            <div class="progress blue"><span style="width:${paidPct}%"></span></div>
            ${c.supplierOpenToPay > 0.005 ? `<div class="meta">open to be paid ${money(c.supplierOpenToPay, cur)}</div>` : `<div class="meta green">nothing open</div>`}
          </div>
          <div class="dc-bar">
            <div class="dc-bar-top"><span>Delivered <span class="tag" style="margin-left:4px">tracking</span></span><b class="gold">${pct(c.deliveryPct)}</b></div>
            <div class="progress ${c.overDelivery > 0 ? 'over' : ''}"><span style="width:${Math.min(100, c.deliveryPct)}%"></span></div>
            <div class="meta">${money(c.deliveredValue, cur)} of ${money(c.deliveryTarget, cur)}</div>
          </div>
        </div>
      </div>
      <div class="dc-side">
        ${isAdmin()
          ? `<div class="dc-income"><div class="k">Our income</div><div class="v">${money(c.incomeKept, cur)}</div></div>`
          : `<div class="dc-income ${c.clientUnderpaidToDate > 0.005 ? 'warn' : ''}"><div class="k">Unpaid for delivered</div><div class="v">${money(c.clientUnderpaidToDate, cur)}</div></div>`}
        <div class="next-action ${naClass}">
          <div class="k">Next action</div>
          <div class="v">${esc(na.label)}</div>
        </div>
        ${c.supplierFundingShortfall > 0.005 ? `<span class="pill red">Funding gap ${money(c.supplierFundingShortfall, cur)}</span>` : ''}
      </div>
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
  const naClass = na.priority === 0 ? 'attn' : (na.code === 'complete_deal' ? 'done' : '');

  const actions = `
    <button class="btn" id="back">← Deals</button>
    ${isAdmin() && deal.status === 'active' ? `<button class="btn" id="editdeal">Edit deal</button>` : ''}
    ${isAdmin() && deal.status === 'active' ? `<button class="btn primary" id="complete">Mark complete</button>` : ''}
    ${isAdmin() && deal.status === 'active' ? `<button class="btn" id="archive">Archive</button>` : ''}
    ${isAdmin() && deal.status === 'completed' ? `<button class="btn" id="reopen">Reopen</button>` : ''}`;

  const roBanner = ro ? `<div class="alert info">This deal is <b>${esc(deal.status)}</b> and read-only.${isAdmin() && deal.status === 'completed' ? ' Reopen it to add activity.' : ''}</div>` : '';
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
    ${roBanner}${pendBanner}${fundBanner}
    <div class="deal-head">
      <h2>${esc(deal.title)}</h2>
      <span class="pill ${deal.status === 'active' ? 'blue' : deal.status === 'completed' ? 'green' : 'gray'}">${esc(deal.status)}</span>
    </div>
    <div class="parties muted" style="margin-bottom:6px">${esc(deal.customer_name)} &nbsp;→&nbsp; ${esc(deal.supplier_name)}</div>
    <div class="derive-line">
      ${isAdmin() ? `
        <span class="dl-chip">Supplier proforma <b>${money(deal.proforma_total, cur)}</b></span>
        <span class="dl-plus">+ ${c.marginPct ? c.marginPct.toFixed(2).replace(/\.00$/, '') : 4}%</span>
        <span class="dl-chip">Our invoice to client <b>${money(deal.invoice_total, cur)}</b></span>
        <span class="dl-eq">=</span>
        <span class="dl-chip gold">Our income <b>${money(c.dealMargin, cur)}</b></span>
      ` : `
        <span class="dl-chip">Agreed order value <b>${money(deal.invoice_total, cur)}</b></span>
        <span class="dl-eq">·</span>
        <span class="dl-chip">Delivered <b>${money(c.deliveredClient, cur)}</b></span>
        <span class="dl-eq">·</span>
        <span class="dl-chip">Received <b>${money(c.totalReceived, cur)}</b></span>
      `}
    </div>
    ${!ro ? `<div class="nextline"><span class="nextline-k">Next:</span> ${esc(na.label)}</div>` : ''}

    <!-- MONEY PICTURE: Client -> Us -> Supplier -->
    <div class="flow">
      <div class="flow-node">
        <div class="flow-role">Client</div>
        <div class="flow-name">${esc(deal.customer_name)}</div>
        <div class="flow-big green">${money(c.totalReceived, cur)}</div>
        <div class="flow-sub">received of ${money(deal.invoice_total, cur)} invoiced</div>
        <div class="progress"><span style="width:${recvPct}%"></span></div>
        ${c.customerBalance > 0.005 ? `<div class="flow-tag amber">Still to collect ${money(c.customerBalance, cur)}</div>` : `<div class="flow-tag green">Fully collected</div>`}
      </div>
      <div class="flow-arrow">→</div>
      <div class="flow-node europa">
        <div class="flow-role">Europa · us</div>
        ${isAdmin() ? `
          <div class="flow-name">Our income ${info('Our income on this deal is the markup: invoice less supplier proforma. It builds up as the client pays. Cash held now also contains the supplier\'s share, which still goes out.')}</div>
          <div class="flow-big gold">${money(c.incomeKept, cur)}</div>
          <div class="flow-sub">earned of ${money(c.feeTotal, cur)} total</div>
          <div class="progress gold"><span style="width:${incPct}%"></span></div>
          <div class="mini3">
            <div class="m3"><span>Cash held now</span><b>${money(c.heldInHouse, cur)}</b></div>
            <div class="m3"><span>Our income (total)</span><b class="gold">${money(c.feeTotal, cur)}</b></div>
            <div class="m3"><span>Still to come in</span><b>${money(c.customerBalance, cur)}</b></div>
          </div>
          ${c.companyMoneyFronted > 0.005 ? `<div class="flow-tag red">Fronted ${money(c.companyMoneyFronted, cur)}</div>` : ''}
        ` : `
          <div class="flow-name">Agreed 4% fee ${info('Your invoice includes our agreed 4% fee, currently ' + money(c.feeTotal, cur) + ' in total. Each payment you make covers a proportional share of it. So far ' + money(c.feePaid, cur) + ' of the fee has been covered and ' + money(c.feeRemaining, cur) + ' is still outstanding.')}</div>
          <div class="flow-big gold">${money(c.feePaid, cur)}</div>
          <div class="flow-sub">of ${money(c.feeTotal, cur)} fee paid</div>
          <div class="progress gold"><span style="width:${Math.min(100, c.feePct || 0)}%"></span></div>
          <div class="flow-tag ${c.feeRemaining > 0.005 ? 'amber' : 'green'}">${c.feeRemaining > 0.005 ? 'Fee remaining ' + money(c.feeRemaining, cur) : 'Fee fully paid'}</div>
        `}
      </div>
      <div class="flow-arrow">→</div>
      <div class="flow-node">
        <div class="flow-role">Supplier</div>
        <div class="flow-name">${esc(deal.supplier_name)}</div>
        <div class="flow-big blue">${money(paidToSupplier, cur)}</div>
        ${isAdmin() ? `
          <div class="flow-sub">paid of ${money(supplierOwed, cur)} owed</div>
          <div class="progress blue"><span style="width:${paidPct}%"></span></div>
          ${c.supplierOpenToPay > 0.005 ? `<div class="flow-tag amber">Open to be paid ${money(c.supplierOpenToPay, cur)}</div>` : `<div class="flow-tag green">Nothing open</div>`}
        ` : `<div class="flow-sub">paid out to the supplier so far</div>`}
      </div>
    </div>

    <!-- OUR POSITION: received vs expected, and in-house vs income -->
    ${(() => {
      const held = c.totalReceived - paidToSupplier;
      const diff = held - c.incomeKept;
      const diffPos = diff >= -0.005;
      const recPct = deal.invoice_total > 0 ? Math.round(c.totalReceived / deal.invoice_total * 100) : 0;
      return `<div class="position">
        <div class="pos-group">
          <div class="pos-item"><div class="pos-k">${isAdmin() ? 'Expected to receive' : 'Order value'}</div><div class="pos-v">${money(deal.invoice_total, cur)}</div></div>
          <div class="pos-item"><div class="pos-k">${isAdmin() ? 'Received so far' : 'Paid by you so far'}</div><div class="pos-v green">${money(c.totalReceived, cur)} <span class="pos-pct">${recPct}%</span></div></div>
          <div class="pos-item"><div class="pos-k">${isAdmin() ? 'Still expecting to collect' : 'Still to pay'}</div><div class="pos-v ${c.customerBalance > 0.005 ? 'amber' : 'green'}">${money(c.customerBalance, cur)}</div></div>
        </div>
        <div class="pos-divider"></div>
        <div class="pos-group">
          ${isAdmin() ? `
          <div class="pos-item"><div class="pos-k">Cash held now ${info('Money currently with us for this deal: ' + money(c.totalReceived, cur) + ' received from the client less ' + money(paidToSupplier, cur) + ' already paid out to the supplier. Part of this is still the supplier\'s and will go out; what stays is our income.')}</div><div class="pos-v">${money(held, cur)}</div></div>
          <div class="pos-item"><div class="pos-k">Our income on this deal ${info('The full markup on this deal: our invoice ' + money(deal.invoice_total, cur) + ' less the supplier proforma ' + money(deal.proforma_total, cur) + '. Of this, ' + money(c.incomeKept, cur) + ' has been earned so far as the client pays, and ' + money(c.incomeRemaining, cur) + ' is still to come.')}</div><div class="pos-v gold">${money(c.feeTotal, cur)}<span class="pos-pct"> · ${money(c.incomeKept, cur)} earned</span></div></div>
          <div class="pos-item"><div class="pos-k">Still to come in ${info('What the client has yet to pay us on this deal.')}</div><div class="pos-v ${c.customerBalance > 0.005 ? 'amber' : 'green'}">${money(c.customerBalance, cur)}</div></div>
          ` : `
          <div class="pos-item"><div class="pos-k">Agreed 4% fee (total)</div><div class="pos-v">${money(c.feeTotal, cur)}</div></div>
          <div class="pos-item"><div class="pos-k">Fee paid so far ${info('Your invoice includes our agreed 4% fee. Every payment you make covers a proportional share of it, so this is how much of the fee your payments have already covered.')}</div><div class="pos-v gold">${money(c.feePaid, cur)}</div></div>
          <div class="pos-item"><div class="pos-k">Fee remaining</div><div class="pos-v ${c.feeRemaining > 0.005 ? 'amber' : 'green'}">${money(c.feeRemaining, cur)}</div></div>
          `}
        </div>
      </div>`;
    })()}

    ${!ro && canWrite() ? `
    <div class="quick-actions">
      ${isAdmin() ? `<button class="btn primary big-btn" id="q-received">＋&nbsp; Money received from client</button>
      <button class="btn big-btn" id="q-paid">＋&nbsp; Money paid to supplier</button>` : ''}
      <button class="btn ${isAdmin() ? '' : 'primary'} big-btn" id="q-delivery">＋&nbsp; Add a delivery</button>
    </div>
    ${isOffice() ? `<div class="meta" style="margin-top:8px">Financial entries are made by an administrator. Deliveries you add are sent for approval.</div>` : ''}` : ''}

    <!-- PAYMENT JOURNEY: money in and money out, always visible -->
    ${paymentsCard(d, cur, ro)}

    <!-- DELIVERY LAYER (separate from money) -->
    ${deliveryCard(d, cur)}

    <!-- 3 DOCUMENT TILES -->
    <div class="section-title" style="margin:24px 0 12px">Documents — tap a tile to upload</div>
    <div class="tiles">
      ${uploadTile(d, 'Invoice to client', 'Customer invoices', '🧾', ro)}
      ${uploadTile(d, 'Main supplier invoice', 'Supplier commercial invoices', '📄', ro)}
      ${uploadTile(d, 'Delivery invoices', 'Delivery notes', '🚚', ro)}
    </div>

    <!-- OPTIONAL FULL DETAIL -->
    <button class="collapse-h details-main" id="details-toggle" style="margin-top:26px"><span class="chev">▶</span> Show full details &amp; history</button>
    <div id="details-body" class="hidden" style="margin-top:14px">
      ${sectionCustomerPrepay(c, cur, ro)}
      ${sectionCloseout(c, cur, deal)}
      ${sectionDocuments(d, cur)}
      ${sectionAudit()}
    </div>
  `, actions);

  wireDeal(d);
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
  if (!invs.length) return `<div class="empty small">No deliveries recorded yet.</div>`;
  return `
    <table class="grid">
      <thead><tr><th>Delivery / invoice #</th><th>Date</th><th class="num">Proforma value</th><th class="num">Client value</th><th>Payment</th><th></th></tr></thead>
      <tbody>
      ${invs.map((i) => {
        const proof = docFor(d, 'supplier_invoice', i.id);
        return `<tr>
          <td data-label="Delivery #">${esc(i.invoice_number)} ${i.status === 'pending' ? '<span class="pill amber">pending</span>' : ''} ${proof ? '<span class="pill green">file</span>' : ''}</td>
          <td data-label="Date">${fdate(i.delivery_date || i.issue_date)}</td>
          <td class="num" data-label="Proforma value">${money(i.proforma_allocated, cur)}</td>
          <td class="num" data-label="Client value">${money(i.customer_sales_value, cur)}</td>
          <td data-label="Payment">${payCell(i)}</td>
          <td class="num" data-label="">
            ${canWrite() && i.status !== 'void' ? `<button class="btn sm" data-upload='${uploadAttr('supplier_invoice', i.id)}'>File</button>` : ''}
            ${isAdmin() && i.status === 'posted' ? `<button class="btn sm danger" data-void='supplier_invoice:${i.id}'>Void</button>` : ''}
          </td>
        </tr>`;
      }).join('')}
      </tbody>
    </table>`;
}
function sectionSupplierInvoices() { return ''; /* deliveries now shown in their own card */ }

/* Payment marker for a delivery: paid (with date) or a planned payment date. */
function payCell(i) {
  const paid = i.pay_status === 'paid';
  const canEdit = canWrite() && i.status !== 'void';
  if (paid) {
    return `<span class="pill green">Paid ${fdate(i.paid_date)}</span>` +
      (canEdit ? ` <button class="btn sm" data-payplan="${i.id}">Change</button>` : '');
  }
  const planned = i.planned_pay_date
    ? `<span class="pill amber">Plan: ${fdate(i.planned_pay_date)}</span>`
    : `<span class="pill gray">Not paid</span>`;
  if (!canEdit) return planned;
  return `${planned} <button class="btn sm" data-paypaid="${i.id}">Mark paid</button> <button class="btn sm" data-payplan="${i.id}">${i.planned_pay_date ? 'Change date' : 'Set date'}</button>`;
}

function markPaidModal(id) {
  const body = `<div class="field"><label>Date paid</label><input id="mp_date" type="date" value="${today()}" /></div>
    <div id="mp_err" class="alert err hidden"></div>`;
  const close = openModal('Mark delivery as paid', body, `<button class="btn" id="mp_no">Cancel</button><button class="btn primary" id="mp_yes">Mark paid</button>`);
  document.getElementById('mp_no').onclick = close;
  document.getElementById('mp_yes').onclick = async () => {
    try { await api('/deliveries/' + id + '/payment', { method: 'PATCH', body: { status: 'paid', date: v('mp_date') } }); close(); ok('Marked as paid.'); renderDeal(); }
    catch (e) { showErr('mp_err', e.message); }
  };
}
function planPayModal(id) {
  const body = `<p class="small muted">Not paid yet? Record when you plan to pay this delivery.</p>
    <div class="field"><label>Planned payment date</label><input id="pp_date" type="date" value="${today()}" /></div>
    <div id="pp_err" class="alert err hidden"></div>`;
  const close = openModal('Planned payment date', body, `<button class="btn" id="pp_no">Cancel</button><button class="btn primary" id="pp_yes">Save date</button>`);
  document.getElementById('pp_no').onclick = close;
  document.getElementById('pp_yes').onclick = async () => {
    try { await api('/deliveries/' + id + '/payment', { method: 'PATCH', body: { status: 'unpaid', date: v('pp_date') } }); close(); ok('Planned date saved.'); renderDeal(); }
    catch (e) { showErr('pp_err', e.message); }
  };
}

/* ---- Section 5: supplier payments ---- */
function sectionSupplierPayments(d, cur, ro) {
  const c = d.computed;
  const pays = d.supplierPayments.filter((p) => p.status !== 'void');
  const rows = pays.length ? pays.map((p) => `
    <tr>
      <td data-label="Date">${fdate(p.date)} ${p.status === 'pending' ? '<span class="pill amber">pending</span>' : ''}</td>
      <td class="num" data-label="Amount">${money(p.amount, cur)}</td>
      <td data-label="Ref">${esc(p.bank_ref || '—')}</td>
      <td class="num" data-label="">
        ${canWrite() && p.status !== 'void' ? `<button class="btn sm" data-upload='${uploadAttr('supplier_payment', p.id)}'>Proof</button>` : ''}
        ${isAdmin() && p.status === 'posted' ? `<button class="btn sm danger" data-void='supplier_payment:${p.id}'>Void</button>` : ''}
      </td>
    </tr>`).join('') : `<tr><td colspan="4" class="muted small">No payments to the supplier yet.</td></tr>`;
  const head = `<div class="rowset" style="margin-bottom:12px">
      ${row('Owed to supplier (proforma)', money(c.supplierOwed, cur))}
      ${row('Paid so far', money(c.totalPaidToSupplier, cur), 'green')}
      ${row('Open to be paid', money(c.supplierOpenToPay, cur), c.supplierOpenToPay > 0 ? 'amber' : 'green')}
      ${c.supplierOverpaid > 0 ? row('Overpaid', money(c.supplierOverpaid, cur), 'red') : ''}
    </div>`;
  const table = `<table class="grid"><thead><tr><th>Date</th><th class="num">Amount</th><th>Ref</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
  const addBtn = !ro && canWrite() ? `<button class="btn sm primary" data-next="add-supp-pay">Record payment to supplier</button>` : '';
  return card('Payments to supplier', head + table, addBtn);
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
        ${isAdmin() ? row('Our income on this deal', money(c.feeTotal, cur) + '  (' + money(c.incomeKept, cur) + ' earned)', 'gold') : row('4% fee paid so far', money(c.feePaid, cur), 'gold')}
        ${isAdmin() ? row('Still to come in', money(c.customerBalance, cur), c.customerBalance > 0.005 ? 'amber' : 'green') : row('4% fee remaining', money(c.feeRemaining, cur), c.feeRemaining > 0.005 ? 'amber' : 'green')}
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

/* ---- Delivery card (separate layer, no money) ---- */
function deliveryCard(d, cur) {
  const c = d.computed;
  const pctW = Math.min(100, c.deliveryPct);
  const ro = d.deal.status !== 'active';
  const body = `
    <div class="dl-head">
      <div><div class="dl-big green">${money(c.deliveredValue, cur)}</div>
        <div class="meta">delivered of ${money(c.deliveryTarget, cur)} (our invoice) · ${pct(c.deliveryPct)}</div>
        <div class="meta">supplier proforma: ${money(c.deliveredProforma, cur)} delivered · ${money(c.proformaRemaining, cur)} remaining</div></div>
      <div class="dl-tags">
        ${c.deliveryOutstanding > 0.005 ? `<span class="flow-tag amber">Awaiting ${money(c.deliveryOutstanding, cur)}</span>` : `<span class="flow-tag green">Fully delivered</span>`}
        ${c.overDelivery > 0.005 ? `<span class="flow-tag red">Over-delivered ${money(c.overDelivery, cur)}</span>` : ''}
        <span class="tag">${c.deliveryCount} batch${c.deliveryCount === 1 ? '' : 'es'}</span>
        ${(() => { const un = (d.supplierInvoices || []).filter((x) => x.status === 'posted' && x.pay_status !== 'paid').length;
          return un ? `<span class="flow-tag amber">${un} not marked paid</span>` : `<span class="flow-tag green">All marked paid</span>`; })()}
      </div>
    </div>
    <div class="progress ${c.overDelivery > 0 ? 'over' : ''}" style="height:10px;margin:10px 0 14px"><span style="width:${pctW}%"></span></div>
    ${deliveriesTable(d, cur)}`;
  const addBtn = !ro && canWrite() ? `<button class="btn sm primary" data-next="add-supp-inv">＋ Add a delivery</button>` : '';
  return card('Deliveries — goods received (does not affect money)', body, addBtn);
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
const DOC_GROUPS = ['Customer invoices', 'Supplier proformas', 'Supplier commercial invoices', 'Customer payment confirmations', 'Supplier payment confirmations', 'Delivery notes', 'Shipping documents', 'Other documents'];
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
  const bind = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
  bind('complete', () => completeDeal(deal));
  bind('closeout-complete', () => completeDeal(deal));
  bind('archive', () => lifecycleAction(deal.id, 'archive', 'Archive this deal?'));
  bind('reopen', () => lifecycleAction(deal.id, 'reopen', 'Reopen this deal for editing?'));
  bind('editdeal', () => editDealModal(deal, d.computed));
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
  document.querySelectorAll('[data-paypaid]').forEach((b) => (b.onclick = () => markPaidModal(b.dataset.paypaid)));
  document.querySelectorAll('[data-payplan]').forEach((b) => (b.onclick = () => planPayModal(b.dataset.payplan)));
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
    const payload = { amount: v('sp_amt'), date: v('sp_date'), bank_ref: v('sp_ref'), notes: v('sp_notes') };
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
    <div class="alert info">A delivery records goods shipped against the supplier proforma. It does <b>not</b> change any payment. The delivery invoice file is required.</div>
    <div class="form-row">
      <div class="field"><label>Delivery invoice number</label><input id="si_num" autofocus /></div>
      <div class="field"><label>Delivery date</label><input id="si_deliv" type="date" value="${today()}" /></div>
    </div>
    <div class="field"><label>Value is stated in</label>
      <select id="si_basis">
        <option value="supplier">Supplier proforma terms</option>
        <option value="client">Our client invoice terms</option>
      </select></div>
    <div class="form-row">
      <div class="field"><label>Value of this delivery</label><input id="si_amt" inputmode="decimal" />
        <div class="hint" id="si_hint">Proforma ${money(deal.proforma_total, cur)} · remaining ${money(c.proformaRemaining, cur)}</div></div>
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
  const basis = document.getElementById('si_basis'), hint = document.getElementById('si_hint');
  basis.onchange = () => {
    hint.textContent = basis.value === 'supplier'
      ? `Proforma ${money(deal.proforma_total, cur)} · remaining ${money(c.proformaRemaining, cur)}`
      : `Our invoice ${money(deal.invoice_total, cur)} · remaining ${money(c.deliveryOutstanding, cur)}`;
  };
  document.getElementById('si_save').onclick = async () => {
    const file = fileIn.files[0];
    if (!file) return showErr('si_err', 'Attach the delivery invoice file — a delivery cannot be saved without it.');
    const fd = new FormData();
    fd.append('file', file);
    fd.append('invoice_number', v('si_num'));
    fd.append('delivery_date', v('si_deliv'));
    fd.append('basis', basis.value);
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
    try { await api('/deals/' + deal.id, { method: 'PATCH', body: payload }); close(); ok('Deal updated.'); renderDeal(); }
    catch (e) { showErr('ed_err', e.message); }
  };
}

/* ---- lifecycle ---- */
function completeDeal(deal) {
  const body = `<p>Mark <b>${esc(deal.ref)}</b> complete? Completed deals become read-only until an administrator reopens them.</p>`;
  const close = openModal('Mark deal complete', body, `<button class="btn" id="c_no">Cancel</button><button class="btn primary" id="c_yes">Mark complete</button>`);
  document.getElementById('c_no').onclick = close;
  document.getElementById('c_yes').onclick = async () => {
    try { await api('/deals/' + deal.id + '/complete', { method: 'POST' }); close(); ok('Deal completed.'); renderDeal(); }
    catch (e) { err(e.message); close(); }
  };
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
  const kind = { customer_payment: 'Customer payment', supplier_payment: 'Supplier payment', supplier_invoice: 'Supplier invoice' }[a.entity_type] || a.entity_type;
  const details = a.entity_type === 'customer_payment'
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

  const dealRows = r.deals.map((d) => `
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
  if (r === 'reports') return renderReports();
  if (r === 'deal') return renderDeal();
  if (r === 'approvals') return isAdmin() ? renderApprovals() : go('deals');
  if (r === 'users') return isAdmin() ? renderUsers() : go('deals');
  if (r === 'archive') return renderArchive();
  return renderDeals();
}

/* ================= BOOT ================= */
(async function boot() {
  try { State.user = await api('/me'); } catch { State.user = null; }
  render();
})();
