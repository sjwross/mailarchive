# Plan: Migrating mailarchive to hosting.com

This document outlines the steps to run mailarchive in your hosting.com environment. No code changes are assumed; it’s a deployment and configuration checklist.

---

## 1. What the app needs

| Requirement | Purpose |
|-------------|---------|
| **Node.js 20+** | API and (optionally) worker |
| **PostgreSQL** | Users, rules, connections, junk-delete rules, migrations |
| **Redis** (optional) | BullMQ worker; only if you run the worker for queue-based jobs |
| **Cron or scheduled HTTP** | Scheduled archive (daily/weekly rules) and junk-delete |
| **HTTPS** | For OAuth callbacks and production use |

The API is the only required process for manual archive, rules, and storage. The worker is optional (currently archive is triggered via API/cron, not only via worker). Cron (or an external scheduler) calls `POST /api/jobs/run-scheduled` and optionally `POST /api/jobs/run-junk-delete`.

---

## 2. Hosting.com capabilities to confirm

Before migrating, confirm hosting.com provides (or you can use):

- **PostgreSQL** – either a managed DB or ability to connect to an external one.
- **Node.js** – supported version (20+), and how to run a long-lived process (e.g. API server).
- **Environment variables** – so you can set `DATABASE_URL`, `JWT_SECRET`, `CRON_SECRET`, OAuth credentials, `ENCRYPTION_KEY`, etc., without putting them in code.
- **Cron jobs or scheduled tasks** – to hit `/api/jobs/run-scheduled` (and optionally `/api/jobs/run-junk-delete`) on a schedule (e.g. daily at 3 AM).
- **Redis** (optional) – only if you plan to run the BullMQ worker.
- **Static file hosting / web server** – to serve the built web app (e.g. `web/dist`) and, if needed, proxy `/api` to the Node API.
- **Domain / URL** – e.g. `https://mailarchive.yourdomain.com` for the app and for OAuth redirect URIs.

---

## 3. Migration steps (high level)

### 3.1 Code and build

1. Get the code on the host (e.g. clone from GitHub or deploy via your CI/CD).
2. Install dependencies: `npm install`.
3. Build: `npm run build` (builds api, worker, web).
4. The API runs from `api/` (e.g. `node api/dist/index.js` or `npm run start -w api`). The web app is static files in `web/dist/`.

### 3.2 Database

1. Create a PostgreSQL database (and user) on hosting.com or your chosen provider.
2. Set `DATABASE_URL` in the hosting environment to point to that database (e.g. `postgres://user:password@host:5432/mailarchive`). If the host **requires SSL** (common on shared hosting), include it in the URL: `postgres://user:password@host:5432/mailarchive?sslmode=require`.
3. **Run migrations on the server:**
   - Create a `.env` file in the **project root** (e.g. `sjwsoftware_subdomains/mailarchive/.env`) with `DATABASE_URL` set to the exact value from your host (including `?sslmode=require` if required). If you see `[dotenv] injecting env (0)`, the file is missing or empty.
   - From the project root run: `npm run db:migrate`. This uses `DATABASE_URL` from `.env` for both the app and migrations.
4. (Optional) If you need to move existing data from your current DB, use `pg_dump` / `pg_restore` or your host’s migration tools; then run any new migrations on the new DB.

### 3.3 Environment variables on hosting.com

Set these in the hosting.com environment (no code changes; values stay in config):

- **Required**
  - `DATABASE_URL` – PostgreSQL connection string for the hosting DB.
  - `JWT_SECRET` – Strong random secret for JWTs.
  - `ENCRYPTION_KEY` – Strong key for encrypting stored tokens/credentials (e.g. 32 chars).
- **Optional but recommended**
  - `PORT` – Port the API listens on (e.g. 3000 or what the host assigns).
  - `CRON_SECRET` – Secret for cron calls to `/api/jobs/run-scheduled` and `/api/jobs/run-junk-delete`.
- **Microsoft OAuth**
  - `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID`
  - `MICROSOFT_REDIRECT_URI` – **Must be your hosting URL**, e.g. `https://mailarchive.yourdomain.com/api/microsoft/callback`
- **Google OAuth** (if using Google Drive)
  - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
  - `GOOGLE_REDIRECT_URI` – **Must be your hosting URL**, e.g. `https://mailarchive.yourdomain.com/api/gdrive/callback`
- **Redis** (only if running the worker)
  - `REDIS_URL` – e.g. `redis://...` on hosting.com or an external Redis.

Reference: `docs/ENVIRONMENT.md` and `.env.example`.

### 3.4 OAuth provider updates (no code changes)

- **Azure AD (Microsoft)**  
  In the app registration, add a **Web** redirect URI:  
  `https://mailarchive.yourdomain.com/api/microsoft/callback`  
  (or whatever your hosting.com URL is). Keep or remove localhost for local dev.

- **Google Cloud Console**  
  In the OAuth 2.0 client (Web application), add an authorized redirect URI:  
  `https://mailarchive.yourdomain.com/api/gdrive/callback`

### 3.5 Run the API (and optionally worker)

- Start the API so it listens on the configured `PORT` and is long-lived (e.g. process manager, systemd, or hosting.com’s “Node app” / “start command”).
- If you use the worker: start it the same way (e.g. `npm run start -w worker` or `node worker/dist/index.js`) and ensure `REDIS_URL` is set.
- Ensure the API is reachable from:
  - The browser (for the web UI and API calls).
  - The host’s cron/scheduler (for `run-scheduled` and `run-junk-delete`).

### 3.6 Serve the web app and proxy API

- Serve the contents of `web/dist/` as the site root (static hosting or web server).
- If the app and API are on the same domain, configure the web server to proxy requests under `/api` to the Node API (e.g. `https://mailarchive.yourdomain.com/api/*` → `http://127.0.0.1:3000/api/*`). This matches the current frontend, which uses relative `/api/...` URLs.
- If hosting.com uses a different URL for the API, you would need a single code change (e.g. base URL for API); this plan assumes same-origin so no change.

### 3.7 Scheduled jobs (cron) on hosting.com

- Create a cron job (or scheduled task) that runs at the desired time (e.g. daily 3 AM server time).
- The job should run a script or `curl` that does:
  - `POST https://mailarchive.yourdomain.com/api/jobs/run-scheduled`
  - Header: `X-Cron-Secret: <CRON_SECRET>`
  - Optionally: `POST .../api/jobs/run-junk-delete` with the same header.
- Use the same `CRON_SECRET` value in the host’s environment and in the cron script. If the repo lives on the server, you can use `scripts/run-scheduled-cron.sh` (or the wrapper) and set `CRON_SECRET` and `MAILARCHIVE_API_URL` in env or a small config file.

### 3.8 Post-migration checks

- Open the app in a browser; log in or register.
- Connect Microsoft (and Google if used); confirm redirect goes to hosting.com and succeeds.
- Create or open a rule; run “Run now” and confirm archive runs and storage (S3 / OneDrive / Google Drive) is used as expected.
- Set “Archive to” preference and run again to confirm.
- After the first cron run, check that scheduled rules ran (e.g. “Last run” on the rule, or cron logs and API logs).

---

## 4. Summary checklist

- [ ] PostgreSQL database created; `DATABASE_URL` set on host.
- [ ] Migrations run against the hosting DB.
- [ ] All required and desired env vars set (JWT, encryption, OAuth, cron, optional Redis).
- [ ] Azure and Google OAuth redirect URIs updated to hosting.com URL.
- [ ] API (and optionally worker) running persistently.
- [ ] Web app (`web/dist`) served; `/api` proxied to API.
- [ ] Cron (or scheduler) configured to call run-scheduled (and optionally run-junk-delete) with `X-Cron-Secret`.
- [ ] Smoke test: login, connect Microsoft/Google, run archive, check scheduled run.

---

## 5. Where things live (reference)

- **Database config / schema:** `docs/DATABASE.md`, `api/migrations/*.js`, `.env` / `api/.node-pg-migrate.json`.
- **Environment variables:** `docs/ENVIRONMENT.md`, `.env.example`.
- **Cron setup:** README “Cron (scheduled archive)”, `scripts/run-scheduled-cron.sh`, `scripts/run-scheduled-cron-wrapper.sh`, `docs/TROUBLESHOOTING.md` §5.

---

## 6. Troubleshooting: PostgreSQL on hosting (e.g. A2 Hosting)

### 6.1 "no pg_hba.conf entry for host … SSL off"

**Error:** `could not connect to postgres: error: no pg_hba.conf entry for host "127.0.0.1", user "…", database "…", SSL off`

**Meaning:** The PostgreSQL server's `pg_hba.conf` is not allowing this connection: it may be configured to allow only SSL connections, or only certain users/hosts.

**What to try:**

1. **Use the host's official connection string**  
   In cPanel (or your host's DB panel), open the PostgreSQL / Remote MySQL® / database section and copy the **exact** connection string or host/user/database/password they show. Put it in `.env` as `DATABASE_URL=...`.

2. **If the host says SSL is required**  
   Append `?sslmode=require` to the URL, e.g.  
   `DATABASE_URL=postgres://user:password@host:5432/dbname?sslmode=require`  
   Then run `npm run db:migrate` again from the project root.

3. **If you then get "The server does not support SSL connections"**  
   The host's Postgres is not actually offering SSL (or not on the host/port you're using), but `pg_hba.conf` may still require SSL. That's a **server-side configuration mismatch**. You need the host to fix it.

### 6.2 "The server does not support SSL connections"

**Error:** `could not connect to postgres: Error: The server does not support SSL connections`

**Meaning:** Your app is connecting with `?sslmode=require`, but the PostgreSQL server you're connecting to is not accepting SSL (or SSL isn't enabled for that instance).

**What to try:**

1. **Remove SSL from the URL**  
   Edit `.env` and remove `?sslmode=require` (and any `&sslmode=...`) from `DATABASE_URL`. Run `npm run db:migrate` again. If you then get the "no pg_hba.conf entry … SSL off" error, the server is configured to require SSL but not offering it — see below.

2. **If you're stuck between both errors**  
   - With `?sslmode=require`: "The server does not support SSL connections"  
   - Without it: "no pg_hba.conf entry … SSL off"  

   Then the host's PostgreSQL is misconfigured (e.g. `pg_hba.conf` requires SSL but the server doesn't have SSL enabled). **Contact the host's support** and say something like:

   - *"I need to run PostgreSQL migrations from my Node.js app on the same server. When I connect without SSL I get 'no pg_hba.conf entry … SSL off'; when I add `?sslmode=require` I get 'The server does not support SSL connections'. Can you either (a) allow local/non-SSL connections from 127.0.0.1 for my database user in `pg_hba.conf`, or (b) provide a working connection string (with SSL if required) that works from a Node.js app on this account?"*

   Once they adjust `pg_hba.conf` or give you a working URL, set that in `DATABASE_URL` in `.env` and run `npm run db:migrate` again.

### 6.3 "[dotenv] injecting env (0) from .env"

**Meaning:** The `.env` file wasn't loaded or had no valid `KEY=value` lines, so `DATABASE_URL` (and other vars) are not set when migrations run.

**What to do:**

1. Ensure `.env` exists in the **project root** (the directory that contains `package.json`), not only in `api/`.
2. Ensure the file contains plain `KEY=value` lines (no spaces around `=`), e.g.  
   `DATABASE_URL=postgres://user:password@host:5432/dbname`
3. Run `npm run db:migrate` from the **project root** so the script can find `./.env`.
4. If you use a different path for `.env`, run:  
   `dotenv -e /path/to/.env -- npm run db:migrate -w api`  
   (from the project root).

### 6.4 Unix socket connection

On some hosts, PostgreSQL allows local connections via a **Unix socket** (e.g. `/tmp/.s.PGSQL.5432`) instead of TCP. Using a socket can avoid pg_hba "SSL off" rules that apply only to TCP.

**We tried this** on a typical shared host (A2-style): the socket in `/tmp` was a symlink into a directory (e.g. `/var/run/postgres/` or `/var/run/postgresql/`) owned by the `postgres` user. The app user (e.g. `projtool`) could not access that path, so the client got **ENOENT** (connect failed as if the socket did not exist). So **Unix socket was not usable** for the app user with that host’s permissions.

If your host documents a socket path that your app user can access, you can try:

- `DATABASE_URL=postgres://user:password@/dbname?host=%2Fpath%2Fto%2Fsocket%2Fdir`  
  (use the **directory** containing `.s.PGSQL.5432`, not the socket file itself; `%2F` = `/`).

If you get ENOENT or "No such file or directory", the socket path is not accessible to your user — stick to TCP and ask the host to fix pg_hba or SSL (see §6.1–6.2).
