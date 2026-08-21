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

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  deal_id INTEGER,
  title TEXT NOT NULL,
  body TEXT,
  kind TEXT NOT NULL DEFAULT 'info',
  read INTEGER NOT NULL DEFAULT 0,
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
  // Go-live clean: create a single administrator if the users table is empty.
  // Change this password immediately after first sign-in (User access → Reset).
  await pool.query(
    'INSERT INTO users (username,name,password_hash,role) VALUES ($1,$2,$3,$4) ON CONFLICT (username) DO NOTHING',
    ['admin', 'Administrator', bcrypt.hashSync('changeme-admin', 10), 'admin']
  );
}

if (require.main === module && process.argv.includes('--seed')) {
  ensureReady().then(() => { console.log('Database ready.'); process.exit(0); })
    .catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { query, pool, ensureReady };
