'use strict';

/**
 * db.js — PostgreSQL data layer (Vercel / Neon build).
 *
 * Uses a single pg connection Pool. On the first request after a cold start we
 * ensure the schema exists and seed initial users once. All queries go through
 * query() which returns { rows }, matching how the routes consume results.
 */

const { Pool, types } = require('pg');
const bcrypt = require('bcryptjs');

// Return NUMERIC (OID 1700) as a JS number, not a string, so the financial
// engine (which expects numbers like SQLite's REAL) works unchanged.
types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));

const connectionString =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL ||
  'postgres://postgres@127.0.0.1:5433/europa';

// Neon / Vercel Postgres require TLS; a local dev DB does not.
const isLocal = /localhost|127\.0\.0\.1/.test(connectionString);
const pool = new Pool({
  connectionString,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  max: 3,
});

async function query(text, params) {
  return pool.query(text, params);
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','office','visitor')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS deals (
  id SERIAL PRIMARY KEY,
  ref TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  supplier_name TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'EUR',
  proforma_total NUMERIC NOT NULL DEFAULT 0,
  invoice_total NUMERIC NOT NULL DEFAULT 0,
  customer_prepay_required NUMERIC NOT NULL DEFAULT 0,
  supplier_prepay_required NUMERIC NOT NULL DEFAULT 0,
  commission_rate NUMERIC NOT NULL DEFAULT 0.04,
  financial_locked INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','completed','archived','deleted','purged')),
  notes TEXT,
  created_by INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS customer_payments (
  id SERIAL PRIMARY KEY,
  deal_id INTEGER NOT NULL REFERENCES deals(id),
  date TEXT NOT NULL,
  ptype TEXT NOT NULL DEFAULT 'payment',
  is_prepayment INTEGER NOT NULL DEFAULT 0,
  amount_received NUMERIC NOT NULL,
  amount_applied NUMERIC NOT NULL,
  overpayment NUMERIC NOT NULL DEFAULT 0,
  kept NUMERIC NOT NULL DEFAULT 0,
  reserved NUMERIC NOT NULL DEFAULT 0,
  bank_ref TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('pending','posted','void')),
  void_reason TEXT,
  created_by INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS supplier_invoices (
  id SERIAL PRIMARY KEY,
  deal_id INTEGER NOT NULL REFERENCES deals(id),
  invoice_number TEXT NOT NULL,
  issue_date TEXT,
  delivery_date TEXT,
  proforma_allocated NUMERIC NOT NULL DEFAULT 0,
  actual_total NUMERIC NOT NULL DEFAULT 0,
  prepay_credit_applied NUMERIC NOT NULL DEFAULT 0,
  customer_sales_value NUMERIC NOT NULL DEFAULT 0,
  quantity TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('pending','posted','void')),
  void_reason TEXT,
  created_by INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS supplier_payments (
  id SERIAL PRIMARY KEY,
  deal_id INTEGER NOT NULL REFERENCES deals(id),
  invoice_id INTEGER REFERENCES supplier_invoices(id),
  date TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  is_prepayment INTEGER NOT NULL DEFAULT 0,
  bank_ref TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('pending','posted','void')),
  void_reason TEXT,
  created_by INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Uploaded files live in the database (bytea) so they survive on Vercel.
CREATE TABLE IF NOT EXISTS documents (
  id SERIAL PRIMARY KEY,
  deal_id INTEGER NOT NULL REFERENCES deals(id),
  category TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  content BYTEA NOT NULL,
  link_type TEXT,
  link_id INTEGER,
  status TEXT NOT NULL DEFAULT 'attached'
    CHECK (status IN ('missing','attached','awaiting','approved','flagged')),
  uploaded_by INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS approvals (
  id SERIAL PRIMARY KEY,
  deal_id INTEGER NOT NULL REFERENCES deals(id),
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  action TEXT NOT NULL,
  summary TEXT NOT NULL,
  requested_by INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  resolved_by INTEGER,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  deal_id INTEGER,
  actor INTEGER,
  actor_name TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id INTEGER,
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

let readyPromise = null;
async function ensureReady() {
  if (!readyPromise) readyPromise = init();
  return readyPromise;
}

async function init() {
  await pool.query(SCHEMA);
  await seed();
}

async function seed() {
  // Idempotent: ON CONFLICT DO NOTHING makes this safe even if two serverless
  // instances run it at the same time on first deploy.
  const mk = (u, name, pw, role) =>
    pool.query('INSERT INTO users (username,name,password_hash,role) VALUES ($1,$2,$3,$4) ON CONFLICT (username) DO NOTHING',
      [u, name, bcrypt.hashSync(pw, 10), role]);
  await mk('admin', 'Administrator', 'admin123', 'admin');
  await mk('office', 'Office Worker', 'office123', 'office');
  await mk('viewer', 'Visitor', 'viewer123', 'visitor');

  const existing = (await pool.query("SELECT 1 FROM deals WHERE ref='DEMO-0001'")).rows[0];
  if (existing) return;
  const admin = (await pool.query("SELECT id FROM users WHERE username='admin'")).rows[0];
  const inserted = (await pool.query(
    `INSERT INTO deals (ref,title,customer_name,supplier_name,currency,proforma_total,invoice_total,
       customer_prepay_required,supplier_prepay_required,commission_rate,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (ref) DO NOTHING RETURNING id`,
    ['DEMO-0001', 'Sample supplement resale deal', 'Sample Customer Ltd', 'Sample Supplier SIA',
      'EUR', 96000, 100000, 30000, 20000, 0.04, admin.id]
  )).rows[0];
  if (inserted) {
    await pool.query(
      `INSERT INTO customer_payments (deal_id,date,ptype,is_prepayment,amount_received,amount_applied,overpayment,kept,reserved,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [inserted.id, '2026-01-15', 'prepayment', 1, 30000, 30000, 0, 1200, 28800, admin.id]
    );
  }
  console.log('Seeded users (admin/admin123, office/office123, viewer/viewer123) and demo deal.');
}

if (require.main === module && process.argv.includes('--seed')) {
  ensureReady().then(() => { console.log('Database ready.'); process.exit(0); })
    .catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { query, pool, ensureReady };
