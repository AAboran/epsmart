# Europa Pharmaceutical — Deal Control (Vercel / PostgreSQL build)

Internal web app for managing back-to-back pharmaceutical trading deals: buy from a
supplier, resell to a customer, keep a 4% margin. Tracks customer and supplier money
separately, computes the 4% / 96% split on every customer receipt, records supplier
invoices and deliveries, and reconciles each deal at closeout — always showing the
single next action.

This build runs on **Vercel** with **PostgreSQL** for storage and keeps uploaded files
in the database. **See `DEPLOY-VERCEL.md` for setup — you must attach a Postgres
database or the app will not start.**

Stack: Node.js + Express (as a Vercel serverless function) + PostgreSQL (`pg`).
Front end is a plain-JavaScript single-page app served by the same function.

## Quick start (local)
```bash
npm install
export DATABASE_URL="postgres://user:pass@localhost:5432/europa"
export EUROPA_JWT_SECRET="any-long-random-string"
npm start   # http://localhost:3000
```
Demo logins: `admin/admin123`, `office/office123`, `viewer/viewer123` — change them.

## How the money works
Every customer receipt is split at the deal's commission rate (default 4%): applied =
min(received, remaining balance); our income = applied × 4%; reserved for supplier =
applied × 96%; anything above is overpayment. The form shows this live before saving
and the balance after. When documented supplier cost breaks the 4%, the deal surfaces
the funding shortfall, actual forecast profit, gap vs the 4% target, and company money
used — nothing is hidden. Amount fields accept 11000 / 11,000 / 11,000.50 / 11.000,50 /
11 000,50.

## Roles & integrity
Administrators post to the ledger, approve office-worker submissions, void entries
(with a reason; originals stay in the audit log), manage users, and run the deal
lifecycle. Office workers propose entries that stay out of all totals until approved.
Visitors are read-only. Unsafe edits are blocked (e.g. changing the 4% rule after
customer payments exist).

## Files
- `api/index.js` — Vercel entry point (imports the Express app)
- `vercel.json` — routes all requests to the function
- `server.js` — Express app: API routes, approvals, voiding, uploads, audit
- `db.js` — PostgreSQL pool, schema, idempotent seed
- `auth.js` — JWT sessions, bcrypt, role middleware
- `finance.js` — pure financial engine + international amount parser
- `public/` — front end (index.html, styles.css, app.js)

## Notes
Uploaded files are capped at 4 MB (Vercel request-body limit). Sessions are stateless
JWT cookies — set `EUROPA_JWT_SECRET`. The approval flow covers create actions; the
approvals table carries an `action` column so edit/void proposals extend the same way.
