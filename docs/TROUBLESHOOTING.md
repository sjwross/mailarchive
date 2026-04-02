## Troubleshooting Guide

This document summarizes the main issues we have hit so far and how to resolve them. A longer **bug/fix history** (for maintainer records) is in [docs/BUG-FIX-HISTORY.md](BUG-FIX-HISTORY.md).

---

### 0. Redeploy locally (pick up code changes)

Restart the API so it loads the latest code:

```bash
npm run dev -w api
```

(or `npm run dev:api` from repo root). Stop any running API (Ctrl+C) first.

---

### 1. API fails to start with `EADDRINUSE: address already in use 127.0.0.1:3000`

**Symptom**

```text
Error: listen EADDRINUSE: address already in use 127.0.0.1:3000
```

**Cause**  
Another process is already bound to port `3000` (typically a previous `npm run dev:api` that is still running).

**Fix**

1. List the process using port 3000:

   ```bash
   lsof -ti:3000
   ```

2. Kill it (replace `<PID>` with the value from the previous command):

   ```bash
   kill -9 <PID>
   ```

3. Restart the API:

   ```bash
   npm run dev -w api
   ```

---

### 2. `{"error":"Missing or invalid Authorization header"}` when using XAMPP / Apache

**Symptom**

- UI calls to `/api/...` (e.g. `/api/gdrive/connect`, `/api/microsoft/status`) return:

  ```json
  { "error": "Missing or invalid Authorization header" }
  ```

**Cause**  
When the UI is served via XAMPP/Apache (e.g. `http://mailarchive.local` or `http://localhost/mailarchive/`), all `/api` requests hit Apache first. If `mod_proxy` / `mod_headers` are not configured to forward the `Authorization` header, the Fastify API never sees the JWT and returns 401.

**Fix (virtual host approach – see `docs/XAMPP.md` for full context)**

In your `mailarchive.local` vhost:

```apache
ProxyPreserveHost On
ProxyPass /api http://127.0.0.1:3000/api
ProxyPassReverse /api http://127.0.0.1:3000/api

# Forward Authorization header reliably
SetEnvIf Authorization "(.*)" HTTP_AUTHORIZATION=$1
RequestHeader set Authorization %{HTTP_AUTHORIZATION}e env=HTTP_AUTHORIZATION
```

Ensure these modules are enabled in `httpd.conf`:

```apache
LoadModule proxy_module modules/mod_proxy.so
LoadModule proxy_http_module modules/mod_proxy_http.so
LoadModule headers_module modules/mod_headers.so
LoadModule rewrite_module modules/mod_rewrite.so
```

Restart Apache after changes.

If you use the provided `apache-mailarchive.conf` from the repo and include it from `httpd-vhosts.conf`, this configuration is already in place.

---

### 3. Google Drive connection

**What works now**

- `GET /api/gdrive/connect` returns an `authUrl` that starts the Google OAuth flow.
- `GET /api/gdrive/callback`:
  - Uses the `state` value to find the user.
  - Exchanges the `code` for tokens.
  - Looks up the Google account’s email via `google.oauth2('v2').userinfo.get`.
  - Stores encrypted `DriveConfig` including `accessToken`, `refreshToken`, `expiryDate`, and `email`.
- `GET /api/gdrive/status` reports:

  ```json
  {
    \"connected\": true,
    \"email\": \"you@example.com\"
  }
  ```

- The UI shows:

  ```text
  Storage (Google Drive)
  Status: Connected (you@example.com)
  ```

**Storage layout in Google Drive**

Archived emails are written under:

```text
mailarchive/{userId}/{Outlook-folder-name}/{year}/{month}/{subjectHash}.eml
```

The `{Outlook-folder-name}` is taken from the source folder’s display name (e.g. `Inbox`, `Sent Items`). There is currently no UI option to override this; the automatic structure is acceptable for v1.

**Archive fails: "First error: Insufficient Permission"**

- **Cause:** The app was using the `drive.file` scope, which only allows access to files the app created. Listing folders in Drive (to find or create the `mailarchive` folder) needs broader permission.
- **Fix:** The app now requests `https://www.googleapis.com/auth/drive`. You must **reconnect Google Drive** so a new token is issued with the new scope: in the UI click **Reconnect Google Drive**, complete the consent screen, then run the archive again.

**Archive fails: "Google Drive API has not been used in project … before or it is disabled"**

- **Symptom:** Archive run completes with **Archived: 0, Failed: N**. API logs show:
  ```text
  Google Drive API has not been used in project YOUR_GCP_PROJECT_NUMBER before or it is disabled.
  Enable it by visiting the link in the error (Google Cloud Console → your project → enable Drive API).
  ```
- **Cause:** The Google Cloud project that owns your OAuth client ID has the **Drive API** disabled or never enabled.
- **Fix:**
  1. Open the link from the error (or go to [Google Cloud Console](https://console.cloud.google.com/) → your project → **APIs & Services** → **Library**).
  2. Search for **Google Drive API**.
  3. Open it and click **Enable**.
  4. Wait a minute if you just enabled it, then run the archive again (e.g. **Run now** in the UI).

---

### 4. Microsoft connect / OAuth – current status and known issues

Microsoft integration is implemented but, in some tenant configurations, the OAuth flow can still fail with an `invalid_request` error from Microsoft. This section documents what is in place and what to check.

**What the code does**

- `GET /api/microsoft/connect`
  - Requires a valid JWT (`Authorization: Bearer <ma_token>`).
  - Generates a `state` (via `generateState()`).
  - Builds an auth URL using MSAL (`@azure/msal-node`) with scopes:
    - `https://graph.microsoft.com/Mail.Read`
    - `https://graph.microsoft.com/Mail.ReadWrite`
    - `offline_access`
  - Stores `{ state, userId }` as a `mailarchive_connections` row with `provider = 'microsoft_oauth_state'`.
  - Returns `{ authUrl, state }`.

- `GET /api/microsoft/callback?code=...&state=...`
  - **Does not require a JWT** (the shared `preHandler` skips auth for `/callback`).
  - Uses `state` to look up the stored `microsoft_oauth_state` row and recover `userId`.
  - Calls `acquireTokenByCode(code)` to get an `AuthenticationResult`.
  - Extracts a refresh token from MSAL’s token cache (if available).
  - Uses Microsoft Graph `getMe` to read the account’s email and ID.
  - Stores encrypted `tokenData` (access token, refresh token, expiry, accountId, email) as a `mailarchive_connections` row with `provider = 'microsoft'`.
  - Deletes the temporary `microsoft_oauth_state` row.
  - Responds with:

    ```json
    {
      \"success\": true,
      \"connectionId\": \"...\", 
      \"email\": \"user@outlook.com\"
    }
    ```

- `GET /api/microsoft/status`
  - Decrypts the stored `tokenData` and returns:

    ```json
    {
      \"connected\": true,
      \"email\": \"user@outlook.com\",
      \"expiresAt\": 1234567890000,
      \"connectionId\": \"...\"
    }
    ```

**What must be configured in Azure AD**

1. **Redirect URI**
   - In the app registration, under **Authentication → Platform configurations → Web**, ensure this URI exists exactly:
     ```text
     http://localhost:3000/api/microsoft/callback
     ```
   - This must match `MICROSOFT_REDIRECT_URI` in `.env`.

2. **API permissions**
   - Under **API permissions**, add (Delegated permissions):
     - `User.Read`
     - `Mail.Read`
     - `Mail.ReadWrite`
   - If you have an admin role (e.g. Global admin), click **“Grant admin consent”** for the tenant so these permissions are fully approved.

3. **Supported account types**
   - For easiest testing, configure the app as:
     - “Accounts in any organizational directory and personal Microsoft accounts”
   - If you restrict it (e.g. to *single‑tenant only*), make sure you sign in with an account from that same tenant and that `MICROSLAVE_TENANT_ID` in `.env` matches the tenant ID.

4. **Tenant ID vs `common`**
   - In `.env`, set `MICROSOFT_TENANT_ID` to your directory (tenant) ID from Azure, for example:
     ```bash
     MICROSOFT_TENANT_ID=00000000-0000-0000-0000-000000000002
     ```
   - You can also set:
     ```bash
     MICROSOFT_TENANT_ID=common
     ```
     if the app is configured as multi‑tenant and you want to allow both personal and work accounts. After changing this, restart the API.

**Known issue: `{\"error\":\"OAuth error: invalid_request\"}`**

- This error is returned by Microsoft during the callback and usually indicates:
  - A redirect URI mismatch.
  - Missing or unapproved permissions.
  - Tenant policies that block user consent for the requested scopes.
- In our testing environment, the Google Drive flow is fully functional, while the Microsoft flow occasionally returns `invalid_request` even with a correct redirect URI and scopes. This appears to be related to tenant‑side consent / policy configuration rather than the Node code.

If you continue to see `invalid_request` after verifying the above, the next step is to:

1. Capture the exact error details shown on the Microsoft consent page (e.g. “admin approval required” messages).
2. Review tenant **User settings → User consent for applications** to confirm whether normal users are allowed to consent to `Mail.Read` / `Mail.ReadWrite`.
3. If necessary, have a tenant admin grant admin consent to the app, or test in a separate dev tenant where you have Global admin rights.

---

### 5. Scheduled archive (cron) didn't run

**Symptom**

- You have a rule with **Schedule** set to **Daily** or **Weekly** and **Safety mode** "Archive then move" (or similar), but at the expected time (e.g. 3:00 AM) no archive run happens.

**Checklist**

1. **Rule schedule**
   - In the UI, confirm the rule's **Schedule** is **Daily** or **Weekly**, not **Manual**. Only non-manual rules are picked up by the scheduled job.

2. **Test the job endpoint (API must be running)**
   - From the repo root, with the API running (e.g. `npm run dev:api`):
     ```bash
     ./scripts/test-scheduled-job.sh
     ```
   - Or: `npm run test:scheduled` (if defined in root `package.json`).
   - You should see a JSON response with `ok: true` and a `summaries` array. If you get **401**, `CRON_SECRET` in `.env` does not match the secret used by the script (or by cron). If you get **connection refused**, the API is not running.

3. **Cron setup**
   - **Repo on external volume (e.g. HubSSD):** macOS cron often cannot run scripts on external volumes. Use the **wrapper** on your main disk:
     - Copy `scripts/run-scheduled-cron-wrapper.sh` to e.g. `~/bin/mailarchive-run-scheduled.sh`, make it executable.
     - Create `~/.mailarchive-cron.env` with `CRON_SECRET=<same value as in project .env>` and optionally `MAILARCHIVE_API_URL=http://localhost:3000`.
     - In crontab: `0 3 * * * $HOME/bin/mailarchive-run-scheduled.sh >> /tmp/mailarchive-cron.log 2>&1`
   - **Repo on main disk:** You can use `scripts/run-scheduled-cron.sh` directly in crontab (it reads `CRON_SECRET` from the repo `.env`).

4. **Cron log**
   - After the cron time, check:
     ```bash
     cat /tmp/mailarchive-cron.log
     ```
   - Look for "Calling …/api/jobs/run-scheduled" and "HTTP 200". If you see "HTTP 401", the secret in `~/.mailarchive-cron.env` does not match the API's `CRON_SECRET`. If you see "curl failed" or no log, cron may not be running the script (path, permissions) or the API was not reachable.

5. **API must be running when cron fires**
   - The scheduled job is a **HTTP call** into the API. If the API is not running at 3:00 AM (or whenever cron runs), the request will fail. Options: run the API in a persistent terminal, use a process manager (e.g. `pm2`), or run it as a system service so it is always up when cron runs.

---

### 6. Archive + delete: where do emails go?

**Safety mode “Archive + delete”** archives each message to your storage (S3 / Google Drive / OneDrive), then **moves** the message to your mailbox’s **Deleted Items** folder (not a permanent delete). You can empty Deleted Items when you want to remove them for good.

---

### 7. API fails at startup with `ECONNREFUSED` on port `5432`

**Symptom**

```text
connect ECONNREFUSED 127.0.0.1:5432
```

(or similar from `pg` / the API log)

**Cause**  
PostgreSQL is not running, or it is not listening on the host/port in `DATABASE_URL`.

**Fix**

1. Start PostgreSQL using your install method (package manager, Postgres.app, Docker, hosted provider, etc.).
2. Confirm something is listening:

   ```bash
   # macOS/Linux
   nc -z 127.0.0.1 5432 && echo ok || echo "nothing on 5432"
   ```

3. Ensure `DATABASE_URL` in `.env` matches that host, port, database name, user, and password.

4. Run migrations if the DB is new:

   ```bash
   npm run db:migrate
   ```

---

### 8. PostgreSQL will not start — stale or invalid `postmaster.pid`

**Symptom**

- `pg_ctl start` reports another server might be running, or start fails.
- `pg_isready` / `nc` show **nothing listening on 5432**.

**Cause**  
The file `postmaster.pid` in PostgreSQL’s data directory is left over from an unclean shutdown, or points at a PID that is **not** the real `postgres` process.

**Fix (only when nothing is listening on 5432)**

1. Verify no server is bound to the port (example for default 5432):

   ```bash
   lsof -nP -iTCP:5432 -sTCP:LISTEN
   ```

   If this prints nothing, no Postgres is listening.

2. Check the PID recorded in `postmaster.pid` (path varies by install; Homebrew often uses a path like `.../var/postgresql@16/postmaster.pid`):

   ```bash
   head -1 /path/to/data/postmaster.pid
   ps -p <that-pid>
   ```

   If the process is **not** `postgres`, the file is invalid.

3. **Remove only the stale pid file** (do not delete other data files), then start the server with your usual command, e.g.:

   ```bash
   rm /path/to/data/postmaster.pid
   pg_ctl -D /path/to/data -l /path/to/data/server.log start
   ```

4. If start still fails, read the server log (often `server.log` next to the data directory or system logs).

**Note:** `brew services start postgresql` can fail with `launchctl` errors on some macOS setups; starting with `pg_ctl` directly may still work. See [LOCAL-INSTALL.md](LOCAL-INSTALL.md) for Homebrew-oriented steps.

