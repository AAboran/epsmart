'use strict';

/**
 * server.js — Vercel / PostgreSQL build.
 * Same API and behaviour as the local build, but persistence is PostgreSQL and
 * uploaded files are stored in the database (so they survive on Vercel).
 */

const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const multer = require('multer');

const { query, ensureReady } = require('./db');
const finance = require('./finance');
const { signToken, verifyPassword, currentUser, requireAuth, requireRole } = require('./auth');

const app = express();
app.use(express.json());
app.use(cookieParser());

// Ensure the schema exists and seed runs once (cheap after the first call).
// Gated to /api so the front-end still loads even if the database is momentarily
// unreachable (the user then sees a clean error on the first API call instead of
// a blank page).
app.use('/api', async (req, res, next) => {
  try { await ensureReady(); next(); } catch (e) { next(e); }
});

// ---------- helpers ----------
const num = (v) => finance.parseAmount(v).value;
const eps = 0.005;
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

async function audit(dealId, user, action, entityType, entityId, detail) {
  await query(
    'INSERT INTO audit_log (deal_id,actor,actor_name,action,entity_type,entity_id,detail) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [dealId, user ? user.id : null, user ? user.name : 'system', action, entityType || null, entityId || null,
      typeof detail === 'string' ? detail : JSON.stringify(detail || {})]
  );
}
async function getDeal(id) {
  return (await query('SELECT * FROM deals WHERE id=$1', [id])).rows[0];
}
async function dealEntries(id) {
  const [cp, si, sp, docs] = await Promise.all([
    query('SELECT * FROM customer_payments WHERE deal_id=$1 ORDER BY date, id', [id]),
    query('SELECT * FROM supplier_invoices WHERE deal_id=$1 ORDER BY issue_date, id', [id]),
    query('SELECT * FROM supplier_payments WHERE deal_id=$1 ORDER BY date, id', [id]),
    query('SELECT id,deal_id,category,original_name,mime,size,link_type,link_id,status,uploaded_by,created_at FROM documents WHERE deal_id=$1 ORDER BY created_at DESC', [id]),
  ]);
  return { customerPayments: cp.rows, supplierInvoices: si.rows, supplierPayments: sp.rows, documents: docs.rows };
}
async function computeFor(deal) {
  const e = await dealEntries(deal.id);
  const c = finance.computeDeal(deal, e.customerPayments, e.supplierInvoices, e.supplierPayments);
  const action = finance.nextAction(deal, c);
  return { entries: e, computed: c, nextAction: action };
}
const entersLedger = (user) => user.role === 'admin';
async function userName(id) {
  const r = (await query('SELECT name FROM users WHERE id=$1', [id])).rows[0];
  return r ? r.name : 'Unknown';
}
async function duplicatePending(dealId, entityType, action, keyAmount, keyDate) {
  const rows = (await query(
    "SELECT summary FROM approvals WHERE deal_id=$1 AND entity_type=$2 AND action=$3 AND status='pending'",
    [dealId, entityType, action]
  )).rows;
  return rows.some((r) => {
    try { const s = JSON.parse(r.summary); return Math.abs((s.amount || 0) - keyAmount) < eps && (s.date || '') === (keyDate || ''); }
    catch { return false; }
  });
}
async function createApproval(dealId, entityType, entityId, action, summary, user) {
  await query('INSERT INTO approvals (deal_id,entity_type,entity_id,action,summary,requested_by) VALUES ($1,$2,$3,$4,$5,$6)',
    [dealId, entityType, entityId, action, JSON.stringify(summary), user.id]);
}

// ---------- auth ----------
app.post('/api/login', wrap(async (req, res) => {
  const { username, password } = req.body || {};
  const user = (await query('SELECT * FROM users WHERE username=$1', [String(username || '').trim()])).rows[0];
  if (!user || !user.active || !verifyPassword(user, String(password || ''))) {
    return res.status(401).json({ error: 'Wrong username or password.' });
  }
  const token = signToken(user);
  res.cookie('token', token, { httpOnly: true, sameSite: 'lax', secure: !/localhost|127/.test(req.headers.host || ''), maxAge: 12 * 3600 * 1000 });
  res.json({ id: user.id, username: user.username, name: user.name, role: user.role });
}));
app.post('/api/logout', (req, res) => { res.clearCookie('token'); res.json({ ok: true }); });
app.get('/api/me', wrap(async (req, res) => {
  const user = await currentUser(req);
  if (!user) return res.status(401).json({ error: 'Not signed in.' });
  res.json(user);
}));

// ---------- users ----------
app.get('/api/users', requireAuth, requireRole('admin'), wrap(async (req, res) => {
  res.json((await query('SELECT id,username,name,role,active,created_at FROM users ORDER BY id')).rows);
}));
app.post('/api/users', requireAuth, requireRole('admin'), wrap(async (req, res) => {
  const { username, name, password, role } = req.body || {};
  if (!username || !name || !password || !['admin', 'office', 'visitor'].includes(role))
    return res.status(400).json({ error: 'Provide username, name, password and a valid role.' });
  const exists = (await query('SELECT 1 FROM users WHERE username=$1', [String(username).trim()])).rows[0];
  if (exists) return res.status(409).json({ error: 'That username is taken.' });
  const bcrypt = require('bcryptjs');
  const id = (await query('INSERT INTO users (username,name,password_hash,role) VALUES ($1,$2,$3,$4) RETURNING id',
    [String(username).trim(), String(name).trim(), bcrypt.hashSync(String(password), 10), role])).rows[0].id;
  await audit(null, req.user, 'create_user', 'user', id, { username, role });
  res.json({ id });
}));
app.patch('/api/users/:id', requireAuth, requireRole('admin'), wrap(async (req, res) => {
  const id = Number(req.params.id);
  const u = (await query('SELECT * FROM users WHERE id=$1', [id])).rows[0];
  if (!u) return res.status(404).json({ error: 'User not found.' });
  const { role, active, password } = req.body || {};
  if (role && ['admin', 'office', 'visitor'].includes(role)) await query('UPDATE users SET role=$1 WHERE id=$2', [role, id]);
  if (active === 0 || active === 1) await query('UPDATE users SET active=$1 WHERE id=$2', [active, id]);
  if (password) { const bcrypt = require('bcryptjs'); await query('UPDATE users SET password_hash=$1 WHERE id=$2', [bcrypt.hashSync(String(password), 10), id]); }
  await audit(null, req.user, 'update_user', 'user', id, { role, active, passwordChanged: !!password });
  res.json({ ok: true });
}));

// ---------- deals ----------
app.get('/api/deals', requireAuth, wrap(async (req, res) => {
  const statuses = req.query.scope === 'archive' ? ['archived', 'deleted'] : ['active', 'completed'];
  const deals = (await query('SELECT * FROM deals WHERE status = ANY($1) ORDER BY created_at DESC', [statuses])).rows;
  const out = [];
  for (const d of deals) {
    const { computed, nextAction } = await computeFor(d);
    out.push({
      id: d.id, ref: d.ref, title: d.title, customer_name: d.customer_name, supplier_name: d.supplier_name,
      currency: d.currency, status: d.status, proforma_total: d.proforma_total, invoice_total: d.invoice_total,
      customer_prepay_required: d.customer_prepay_required, computed, nextAction,
    });
  }
  out.sort((a, b) => a.nextAction.priority - b.nextAction.priority);
  const active = out.filter((d) => d.status === 'active');
  const sum = (f) => finance.round2(active.reduce((s, d) => s + f(d.computed, d), 0));
  const portfolio = {
    activeDeals: active.length,
    totalInvoiced: sum((c, d) => d.invoice_total),
    totalReceived: sum((c) => c.totalReceived),
    totalCustomerBalance: sum((c) => c.customerBalance),
    totalSupplierOpen: sum((c) => c.supplierInvoicesOpen),
    totalIncomeKept: sum((c) => c.incomeKept),
    totalIncomeExpected: sum((c) => c.incomeExpectedTotal),
    totalIncomeExpectedRemaining: sum((c) => c.incomeRemaining),
  };
  res.json({ deals: out, portfolio });
}));

app.get('/api/deals/:id', requireAuth, wrap(async (req, res) => {
  const d = await getDeal(Number(req.params.id));
  if (!d) return res.status(404).json({ error: 'Deal not found.' });
  const { entries, computed, nextAction } = await computeFor(d);
  const pend = (await query("SELECT * FROM approvals WHERE deal_id=$1 AND status='pending' ORDER BY created_at DESC", [d.id])).rows;
  for (const a of pend) a.requested_by_name = await userName(a.requested_by);
  res.json({ deal: d, ...entries, computed, nextAction, pendingApprovals: pend });
}));

app.post('/api/deals', requireAuth, requireRole('admin', 'office'), wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.ref || !b.title || !b.customer_name || !b.supplier_name)
    return res.status(400).json({ error: 'Reference, title, customer and supplier are required.' });
  const dup = (await query('SELECT 1 FROM deals WHERE ref=$1', [String(b.ref).trim()])).rows[0];
  if (dup) return res.status(409).json({ error: 'A deal with that reference already exists.' });
  let rate = num(b.commission_rate); if (!rate || rate <= 0) rate = 0.04; if (rate > 1) rate = rate / 100;
  const id = (await query(
    `INSERT INTO deals (ref,title,customer_name,supplier_name,currency,proforma_total,invoice_total,
       customer_prepay_required,supplier_prepay_required,commission_rate,notes,created_by,status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'active') RETURNING id`,
    [String(b.ref).trim(), String(b.title).trim(), String(b.customer_name).trim(), String(b.supplier_name).trim(),
      (b.currency || 'EUR').trim(), num(b.proforma_total), num(b.invoice_total), num(b.customer_prepay_required),
      num(b.supplier_prepay_required), rate, b.notes || null, req.user.id]
  )).rows[0].id;
  await audit(id, req.user, 'create_deal', 'deal', id, { ref: b.ref });
  res.json({ id });
}));

app.patch('/api/deals/:id', requireAuth, requireRole('admin'), wrap(async (req, res) => {
  const d = await getDeal(Number(req.params.id));
  if (!d) return res.status(404).json({ error: 'Deal not found.' });
  if (d.status !== 'active') return res.status(409).json({ error: 'Only active deals can be edited. Reopen it first.' });
  const b = req.body || {};
  const { computed } = await computeFor(d);
  const hasFinancialActivity = computed.totalApplied > eps || computed.supplierInvoicesGross > eps || computed.supplierPrepaySent > eps;
  const hasCustomerPayments = computed.totalApplied > eps;

  const cols = [], vals = [];
  const set = (c, v) => { cols.push(c + '=$' + (vals.length + 1)); vals.push(v); };
  if (b.title != null) set('title', String(b.title).trim());
  if (b.customer_name != null) set('customer_name', String(b.customer_name).trim());
  if (b.supplier_name != null) set('supplier_name', String(b.supplier_name).trim());
  if (b.notes != null) set('notes', String(b.notes));
  if (b.invoice_total != null) {
    const val = num(b.invoice_total);
    if (val < computed.totalApplied - eps) return res.status(400).json({ error: `Customer invoice cannot be reduced below applied receipts (${computed.totalApplied}).` });
    set('invoice_total', val);
  }
  if (b.proforma_total != null) {
    const val = num(b.proforma_total);
    if (val < computed.proformaAllocated - eps) return res.status(400).json({ error: `Supplier proforma cannot be reduced below allocated batches (${computed.proformaAllocated}).` });
    set('proforma_total', val);
  }
  if (b.customer_prepay_required != null) {
    const val = num(b.customer_prepay_required);
    if (hasFinancialActivity) return res.status(400).json({ error: 'The payment plan cannot change once financial activity exists.' });
    if (val < computed.prepayReceived - eps) return res.status(400).json({ error: 'Prepayment requirement cannot drop below amounts already paid.' });
    set('customer_prepay_required', val);
  }
  if (b.supplier_prepay_required != null) {
    const val = num(b.supplier_prepay_required);
    if (hasFinancialActivity) return res.status(400).json({ error: 'The payment plan cannot change once financial activity exists.' });
    if (val < computed.supplierPrepaySent - eps) return res.status(400).json({ error: 'Supplier prepayment requirement cannot drop below amounts already sent.' });
    set('supplier_prepay_required', val);
  }
  if (b.commission_rate != null) {
    if (hasCustomerPayments) return res.status(400).json({ error: 'The 4% rule cannot change after customer payments exist.' });
    let rate = num(b.commission_rate); if (rate > 1) rate = rate / 100;
    if (rate <= 0) return res.status(400).json({ error: 'Commission rate must be positive.' });
    set('commission_rate', rate);
  }
  if (cols.length) {
    vals.push(d.id);
    await query(`UPDATE deals SET ${cols.join(', ')} WHERE id=$${vals.length}`, vals);
    await audit(d.id, req.user, 'edit_deal', 'deal', d.id, b);
  }
  res.json({ ok: true });
}));

function lifecycle(action, fromStatuses, toStatus) {
  return wrap(async (req, res) => {
    const d = await getDeal(Number(req.params.id));
    if (!d) return res.status(404).json({ error: 'Deal not found.' });
    if (!fromStatuses.includes(d.status)) return res.status(409).json({ error: `Cannot ${action} a deal in "${d.status}" state.` });
    if (action === 'complete') await query("UPDATE deals SET status='completed', completed_at=NOW() WHERE id=$1", [d.id]);
    else if (action === 'reopen') await query("UPDATE deals SET status='active', completed_at=NULL WHERE id=$1", [d.id]);
    else await query('UPDATE deals SET status=$1 WHERE id=$2', [toStatus, d.id]);
    await audit(d.id, req.user, action + '_deal', 'deal', d.id, {});
    res.json({ ok: true, status: toStatus });
  });
}
app.post('/api/deals/:id/complete', requireAuth, requireRole('admin'), lifecycle('complete', ['active'], 'completed'));
app.post('/api/deals/:id/reopen', requireAuth, requireRole('admin'), lifecycle('reopen', ['completed', 'archived'], 'active'));
app.post('/api/deals/:id/archive', requireAuth, requireRole('admin'), lifecycle('archive', ['active', 'completed'], 'archived'));
app.post('/api/deals/:id/delete', requireAuth, requireRole('admin'), lifecycle('delete', ['archived'], 'deleted'));
app.post('/api/deals/:id/purge', requireAuth, requireRole('admin'), wrap(async (req, res) => {
  const d = await getDeal(Number(req.params.id));
  if (!d) return res.status(404).json({ error: 'Deal not found.' });
  if (d.status !== 'deleted') return res.status(409).json({ error: 'Only deleted deals can be permanently removed.' });
  if ((req.body && req.body.confirm) !== d.ref) return res.status(400).json({ error: `Type the exact reference "${d.ref}" to permanently delete.` });
  await query("UPDATE deals SET status='purged' WHERE id=$1", [d.id]);
  await audit(d.id, req.user, 'purge_deal', 'deal', d.id, { ref: d.ref });
  res.json({ ok: true });
}));

// ---------- customer payments ----------
app.post('/api/deals/:id/customer-payments', requireAuth, requireRole('admin', 'office'), wrap(async (req, res) => {
  const d = await getDeal(Number(req.params.id));
  if (!d) return res.status(404).json({ error: 'Deal not found.' });
  if (d.status !== 'active') return res.status(409).json({ error: 'This deal is not open for new entries.' });
  const b = req.body || {};
  const received = num(b.amount);
  if (!(received > 0)) return res.status(400).json({ error: 'Enter an amount greater than zero.' });
  if (!b.date) return res.status(400).json({ error: 'A payment date is required.' });
  const { computed } = await computeFor(d);
  const remaining = Math.max(0, computed.invoiceTotal - computed.totalApplied);
  const applied = finance.round2(Math.min(received, remaining));
  const overpayment = finance.round2(received - applied);
  const { kept, reserved } = finance.splitApplied(applied, computed.rate);
  const isPrepay = b.ptype === 'prepayment' ? 1 : 0;
  const status = entersLedger(req.user) ? 'posted' : 'pending';
  if (!entersLedger(req.user) && await duplicatePending(d.id, 'customer_payment', 'create', received, b.date))
    return res.status(409).json({ error: 'An identical submission is already awaiting approval.' });
  const id = (await query(
    `INSERT INTO customer_payments (deal_id,date,ptype,is_prepayment,amount_received,amount_applied,overpayment,kept,reserved,bank_ref,notes,status,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
    [d.id, b.date, b.ptype || 'payment', isPrepay, received, applied, overpayment, kept, reserved, b.bank_ref || null, b.notes || null, status, req.user.id]
  )).rows[0].id;
  const summary = { amount: received, applied, kept, reserved, overpayment, date: b.date, ptype: b.ptype || 'payment' };
  if (status === 'pending') await createApproval(d.id, 'customer_payment', id, 'create', summary, req.user);
  await audit(d.id, req.user, status === 'posted' ? 'post_customer_payment' : 'propose_customer_payment', 'customer_payment', id, summary);
  res.json({ id, status, applied, kept, reserved, overpayment });
}));

app.post('/api/deals/:id/customer-payments/preview', requireAuth, wrap(async (req, res) => {
  const d = await getDeal(Number(req.params.id));
  if (!d) return res.status(404).json({ error: 'Deal not found.' });
  const received = num((req.body || {}).amount);
  const { computed } = await computeFor(d);
  const remaining = Math.max(0, computed.invoiceTotal - computed.totalApplied);
  const applied = finance.round2(Math.min(received, remaining));
  const overpayment = finance.round2(received - applied);
  const { kept, reserved } = finance.splitApplied(applied, computed.rate);
  res.json({ received, applied, kept, reserved, overpayment, rate: computed.rate, balanceAfter: finance.round2(Math.max(0, computed.invoiceTotal - (computed.totalApplied + applied))) });
}));

// ---------- supplier invoices ----------
app.post('/api/deals/:id/supplier-invoices', requireAuth, requireRole('admin', 'office'), wrap(async (req, res) => {
  const d = await getDeal(Number(req.params.id));
  if (!d) return res.status(404).json({ error: 'Deal not found.' });
  if (d.status !== 'active') return res.status(409).json({ error: 'This deal is not open for new entries.' });
  const b = req.body || {};
  if (!b.invoice_number) return res.status(400).json({ error: 'A supplier invoice number is required.' });
  const proformaAlloc = num(b.proforma_allocated);
  if (!(proformaAlloc > 0)) return res.status(400).json({ error: 'Enter the documented proforma value allocated to this batch.' });
  const actual = num(b.actual_total);
  const prepayCredit = num(b.prepay_credit_applied);
  if (prepayCredit < 0) return res.status(400).json({ error: 'Prepayment credit cannot be negative.' });
  if (prepayCredit > actual + eps) return res.status(400).json({ error: 'Prepayment credit cannot exceed the invoice total.' });
  const status = entersLedger(req.user) ? 'posted' : 'pending';
  const id = (await query(
    `INSERT INTO supplier_invoices (deal_id,invoice_number,issue_date,delivery_date,proforma_allocated,actual_total,prepay_credit_applied,customer_sales_value,quantity,notes,status,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
    [d.id, String(b.invoice_number).trim(), b.issue_date || null, b.delivery_date || null, proformaAlloc, actual, prepayCredit, num(b.customer_sales_value), b.quantity || null, b.notes || null, status, req.user.id]
  )).rows[0].id;
  const summary = { amount: actual, invoice_number: b.invoice_number, proforma_allocated: proformaAlloc, prepay_credit_applied: prepayCredit, customer_sales_value: num(b.customer_sales_value), date: b.issue_date || '' };
  if (status === 'pending') await createApproval(d.id, 'supplier_invoice', id, 'create', summary, req.user);
  await audit(d.id, req.user, status === 'posted' ? 'post_supplier_invoice' : 'propose_supplier_invoice', 'supplier_invoice', id, summary);
  res.json({ id, status });
}));

// ---------- supplier payments ----------
app.post('/api/deals/:id/supplier-payments', requireAuth, requireRole('admin', 'office'), wrap(async (req, res) => {
  const d = await getDeal(Number(req.params.id));
  if (!d) return res.status(404).json({ error: 'Deal not found.' });
  if (d.status !== 'active') return res.status(409).json({ error: 'This deal is not open for new entries.' });
  const b = req.body || {};
  const amount = num(b.amount);
  if (!(amount > 0)) return res.status(400).json({ error: 'Enter an amount greater than zero.' });
  if (!b.date) return res.status(400).json({ error: 'A payment date is required.' });
  const isPrepay = b.is_prepayment ? 1 : 0;
  let invoiceId = null;
  if (!isPrepay) {
    invoiceId = b.invoice_id ? Number(b.invoice_id) : null;
    if (!invoiceId) return res.status(400).json({ error: 'Select the supplier invoice this payment settles.' });
    const inv = (await query('SELECT * FROM supplier_invoices WHERE id=$1 AND deal_id=$2', [invoiceId, d.id])).rows[0];
    if (!inv || inv.status !== 'posted') return res.status(400).json({ error: 'That supplier invoice is not available for payment.' });
    const paid = (await query("SELECT COALESCE(SUM(amount),0) AS s FROM supplier_payments WHERE invoice_id=$1 AND is_prepayment=0 AND status='posted'", [invoiceId])).rows[0].s;
    const open = finance.round2(Number(inv.actual_total) - Number(inv.prepay_credit_applied) - Number(paid));
    if (amount > open + eps) return res.status(400).json({ error: `Payment exceeds the invoice open balance (${open}). Enter ${open} or less.` });
  }
  const status = entersLedger(req.user) ? 'posted' : 'pending';
  if (!entersLedger(req.user) && await duplicatePending(d.id, 'supplier_payment', 'create', amount, b.date))
    return res.status(409).json({ error: 'An identical submission is already awaiting approval.' });
  const id = (await query(
    'INSERT INTO supplier_payments (deal_id,invoice_id,date,amount,is_prepayment,bank_ref,notes,status,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
    [d.id, invoiceId, b.date, amount, isPrepay, b.bank_ref || null, b.notes || null, status, req.user.id]
  )).rows[0].id;
  const summary = { amount, date: b.date, is_prepayment: isPrepay, invoice_id: invoiceId };
  if (status === 'pending') await createApproval(d.id, 'supplier_payment', id, 'create', summary, req.user);
  await audit(d.id, req.user, status === 'posted' ? 'post_supplier_payment' : 'propose_supplier_payment', 'supplier_payment', id, summary);
  res.json({ id, status });
}));

// ---------- voiding ----------
const VOID_TABLES = { customer_payment: 'customer_payments', supplier_payment: 'supplier_payments', supplier_invoice: 'supplier_invoices' };
app.post('/api/void/:type/:id', requireAuth, requireRole('admin'), wrap(async (req, res) => {
  const table = VOID_TABLES[req.params.type];
  if (!table) return res.status(400).json({ error: 'Unknown entry type.' });
  const reason = ((req.body && req.body.reason) || '').trim();
  if (!reason) return res.status(400).json({ error: 'A reason is required to void an entry.' });
  const row = (await query(`SELECT * FROM ${table} WHERE id=$1`, [Number(req.params.id)])).rows[0];
  if (!row) return res.status(404).json({ error: 'Entry not found.' });
  if (row.status === 'void') return res.status(409).json({ error: 'This entry is already void.' });
  await query(`UPDATE ${table} SET status='void', void_reason=$1 WHERE id=$2`, [reason, row.id]);
  await audit(row.deal_id, req.user, 'void_' + req.params.type, req.params.type, row.id, { reason });
  res.json({ ok: true });
}));

// ---------- approvals ----------
app.get('/api/approvals', requireAuth, requireRole('admin'), wrap(async (req, res) => {
  const rows = (await query("SELECT * FROM approvals WHERE status='pending' ORDER BY created_at")).rows;
  const out = [];
  for (const a of rows) {
    const deal = await getDeal(a.deal_id);
    const docs = (await query('SELECT id,original_name,mime FROM documents WHERE link_type=$1 AND link_id=$2', [a.entity_type, a.entity_id])).rows;
    out.push({
      ...a, summary: JSON.parse(a.summary), requested_by_name: await userName(a.requested_by),
      deal_ref: deal ? deal.ref : '(removed)', deal_title: deal ? deal.title : '',
      customer_name: deal ? deal.customer_name : '', supplier_name: deal ? deal.supplier_name : '', documents: docs,
    });
  }
  res.json(out);
}));
function resolveApproval(approve) {
  return wrap(async (req, res) => {
    const a = (await query("SELECT * FROM approvals WHERE id=$1 AND status='pending'", [Number(req.params.id)])).rows[0];
    if (!a) return res.status(404).json({ error: 'Approval not found or already resolved.' });
    const table = VOID_TABLES[a.entity_type];
    if (table && a.entity_id) await query(`UPDATE ${table} SET status=$1 WHERE id=$2`, [approve ? 'posted' : 'void', a.entity_id]);
    await query("UPDATE approvals SET status=$1, resolved_by=$2, resolved_at=NOW() WHERE id=$3", [approve ? 'approved' : 'rejected', req.user.id, a.id]);
    await audit(a.deal_id, req.user, approve ? 'approve' : 'reject', a.entity_type, a.entity_id, { approvalId: a.id });
    res.json({ ok: true });
  });
}
app.post('/api/approvals/:id/approve', requireAuth, requireRole('admin'), resolveApproval(true));
app.post('/api/approvals/:id/reject', requireAuth, requireRole('admin'), resolveApproval(false));

// ---------- documents (stored in Postgres) ----------
const ALLOWED = new Set(['application/pdf', 'image/png', 'image/jpeg']);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 }, // 4 MB — Vercel serverless request-body ceiling
  fileFilter: (req, file, cb) => cb(null, ALLOWED.has(file.mimetype)),
});
app.post('/api/deals/:id/documents', requireAuth, requireRole('admin', 'office'), upload.single('file'), wrap(async (req, res) => {
  const d = await getDeal(Number(req.params.id));
  if (!d) return res.status(404).json({ error: 'Deal not found.' });
  if (!req.file) return res.status(400).json({ error: 'Attach a PDF, PNG or JPEG file (max 4 MB).' });
  const b = req.body || {};
  const status = req.user.role === 'admin' ? 'approved' : 'awaiting';
  const id = (await query(
    `INSERT INTO documents (deal_id,category,original_name,mime,size,content,link_type,link_id,status,uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [d.id, b.category || 'Other documents', req.file.originalname, req.file.mimetype, req.file.size, req.file.buffer,
      b.link_type || null, b.link_id ? Number(b.link_id) : null, status, req.user.id]
  )).rows[0].id;
  await audit(d.id, req.user, 'upload_document', 'document', id, { name: req.file.originalname, category: b.category });
  res.json({ id, status });
}));
app.patch('/api/documents/:id', requireAuth, requireRole('admin'), wrap(async (req, res) => {
  const status = (req.body || {}).status;
  if (!['missing', 'attached', 'awaiting', 'approved', 'flagged'].includes(status)) return res.status(400).json({ error: 'Invalid document status.' });
  const doc = (await query('SELECT id,deal_id FROM documents WHERE id=$1', [Number(req.params.id)])).rows[0];
  if (!doc) return res.status(404).json({ error: 'Document not found.' });
  await query('UPDATE documents SET status=$1 WHERE id=$2', [status, doc.id]);
  await audit(doc.deal_id, req.user, 'set_document_status', 'document', doc.id, { status });
  res.json({ ok: true });
}));
app.get('/api/documents/:id/file', requireAuth, wrap(async (req, res) => {
  const doc = (await query('SELECT * FROM documents WHERE id=$1', [Number(req.params.id)])).rows[0];
  if (!doc) return res.status(404).json({ error: 'Document not found.' });
  res.setHeader('Content-Type', doc.mime);
  res.setHeader('Content-Disposition', `inline; filename="${String(doc.original_name).replace(/"/g, '')}"`);
  res.send(doc.content); // bytea -> Buffer
}));

// ---------- audit ----------
app.get('/api/deals/:id/audit', requireAuth, wrap(async (req, res) => {
  res.json((await query('SELECT * FROM audit_log WHERE deal_id=$1 ORDER BY created_at DESC, id DESC', [Number(req.params.id)])).rows);
}));

// ---------- brand images ----------
const BRAND_IMAGES = new Set(['europa-logo.png', 'europa-icon.png', 'boran-coat.png']);
app.get('/img/:name', (req, res) => {
  if (!BRAND_IMAGES.has(req.params.name)) return res.status(404).end();
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(path.join(__dirname, req.params.name));
});

// ---------- static frontend (flat layout: assets sit next to server.js) ----------
app.get(['/', '/index.html'], (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/app.js', (req, res) => res.sendFile(path.join(__dirname, 'app.js')));
app.get('/styles.css', (req, res) => res.sendFile(path.join(__dirname, 'styles.css')));
// Single-page app fallback for any non-API route.
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ---------- errors ----------
app.use((err, req, res, next) => {
  console.error(err);
  if (err && err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File is too large (max 4 MB on this host).' });
  if (err && err.message) return res.status(400).json({ error: err.message });
  res.status(500).json({ error: 'Something went wrong.' });
});

// Only start a listening server when run directly (local dev). On Vercel the
// app is imported by api/index.js and invoked per-request instead.
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Europa Deal Control running on http://localhost:${PORT}`));
}

module.exports = app;
