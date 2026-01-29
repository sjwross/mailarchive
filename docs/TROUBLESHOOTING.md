## Troubleshooting Guide

This document summarizes the main issues we have hit so far and how to resolve them.

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
  Google Drive API has not been used in project 955509933373 before or it is disabled.
  Enable it by visiting https://console.developers.google.com/apis/api/drive.googleapis.com/overview?project=955509933373
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
   - In `.env` you currently have:
     ```bash
     MICROSOFT_TENANT_ID=cc7312ca-599d-4e5f-b455-863356f48151
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

