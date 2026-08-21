# Europa Deal Control — Vercel (flat layout)

Every file sits at the top level (no folders) so it uploads to GitHub cleanly.

## Files that belong in the repo (all at the top level)
server.js, db.js, auth.js, finance.js, app.js, index.html, styles.css,
package.json, package-lock.json, vercel.json,
europa-logo.png, europa-icon.png, boran-coat.png

Delete anything else (old `index.js`, `download`, `download (1)`, or any folder).

## Requirements on Vercel
1. A Postgres database connected to the project (sets DATABASE_URL / POSTGRES_URL).
2. Environment variable EUROPA_JWT_SECRET = a long random string.
After changing files, wait for Vercel to redeploy, then hard-refresh the site.

## Going live — first sign in
On a brand-new database the app creates ONE administrator:
  username: admin    password: changeme-admin
Sign in and immediately change it in User access → Reset password.
There are no demo/office/viewer accounts and no sample deal — create your own users
and deals. Passwords are stored encrypted and can never be shown; use Reset password
to set a new one (you can copy it at that moment).
