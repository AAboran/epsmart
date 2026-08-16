# Europa Deal Control — Vercel (flat layout)

This version keeps EVERY file at the top level (no folders), which is the layout
that uploads to GitHub cleanly. Do not put any of these files inside a folder.

## Files that belong in the repo (all at the top level)
server.js, db.js, auth.js, finance.js, index.html, app.js, styles.css,
package.json, package-lock.json, vercel.json

Anything else (for example old files named `index.js`, `download`, `download (1)`,
or a `public/` or `api/` folder) should be deleted from the repo.

## Requirements on Vercel (already set if you got this far)
1. A Postgres database connected to the project (adds DATABASE_URL / POSTGRES_URL).
2. Environment variable EUROPA_JWT_SECRET = a long random string.
After changing files, wait for Vercel to redeploy, then open the site.

Demo logins: admin/admin123, office/office123, viewer/viewer123 — change them under
User access after first sign-in.

## Run locally (optional)
npm install
set DATABASE_URL and EUROPA_JWT_SECRET, then: npm start  ->  http://localhost:3000
