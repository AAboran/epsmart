# Deploying to Vercel

This build is made for Vercel. The two things Vercel could not do before are now
solved:

- **Database:** uses PostgreSQL instead of a local file, so your data persists.
- **Uploaded files:** stored inside the database (not on disk), so they persist too.

You must attach a Postgres database — the app will not work without one.

---

## Steps

### 1. Put this version on GitHub
Replace your current repo contents with the files in this project (or push a new
commit). Do not upload the `node_modules` or `data` folders.

### 2. Import the repo into Vercel
Vercel → **Add New… → Project** → pick the GitHub repo → **Deploy**.
The included `vercel.json` and `api/index.js` tell Vercel how to run the server;
you do not need to change any build settings.

### 3. Add a Postgres database (required)
In your Vercel project → **Storage** tab → **Create Database** → **Postgres** →
connect it to this project. Vercel automatically adds the connection environment
variables (`POSTGRES_URL` / `DATABASE_URL`) — the app reads them on its own.

> Any Postgres works (e.g. Neon at neon.tech, free tier). If you use one from
> outside Vercel, add its connection string as an environment variable named
> `DATABASE_URL` in step 4.

### 4. Add the session secret
Project → **Settings → Environment Variables** → add:

| Name                 | Value                                  |
|----------------------|----------------------------------------|
| `EUROPA_JWT_SECRET`  | any long random string (e.g. 40+ chars)|

Without this, users get logged out unpredictably.

### 5. Redeploy
Project → **Deployments** → redeploy the latest (so it picks up the database and
secret). Open the URL. On first load the tables are created and seeded.

Sign in with `admin` / `admin123` (also `office` / `office123`, `viewer` /
`viewer123`) and **change these immediately** under *User access*.

---

## Things to know on Vercel

- **File uploads are limited to 4 MB each.** Vercel caps the size of a request to a
  serverless function at ~4.5 MB, so larger scans will be rejected. Keep invoice and
  confirmation files small, or host on a platform with a persistent disk (Render, a
  VPS) if you need larger files — the other build (`server.js` + SQLite) supports up
  to 25 MB on such hosts.
- **Cold starts.** After a quiet period the first request wakes the function and can
  take a second or two. Normal for serverless.
- **Database connections.** The app uses a small pool (max 3). If you ever see
  connection-limit errors under heavy use, use Vercel/Neon's *pooled* connection
  string (the default they provide is already pooled).

---

## Running locally (optional)
You need a local PostgreSQL and a connection string:

```bash
npm install
export DATABASE_URL="postgres://user:pass@localhost:5432/europa"
export EUROPA_JWT_SECRET="any-long-random-string"
npm start          # http://localhost:3000
```
