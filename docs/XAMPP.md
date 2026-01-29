# Running the web UI behind XAMPP (Apache)

If you serve the mailarchive web UI through XAMPP’s Apache instead of Vite’s dev server, the browser sends `/api` requests to Apache. Apache must **proxy** those to the Node API (port 3000) and **forward the Authorization header**, or you’ll get “Missing or invalid Authorization header”.

## 1. Build the web UI

From the repo root:

```bash
npm run build
```

This builds the UI into `web/dist/`. The Apache config below points to `/Volumes/HubSSD/www/mailarchive/web/dist`.

## 2. Proxy /api to the Node API

**Important:** The proxy configuration below only affects requests to `/api/*` **within the mailarchive virtual host or directory**. Your other apps (ProjToolbox, blog, academy-clean, etc.) are completely unaffected because they use different URLs or directories.

Ensure these Apache modules are enabled (e.g. in `httpd.conf`):

- `mod_proxy`
- `mod_proxy_http`
- `mod_headers` (for forwarding Authorization)

Then configure a proxy for `/api` and forward the Authorization header.

### Option A: Virtual host (recommended - SAFEST, won't affect other apps)

**A ready-to-use config file is included:** `apache-mailarchive.conf` in the project root.

**Steps:**

1. **Add to hosts file** (so `mailarchive.local` resolves to localhost):
   - **Mac/Linux:** Edit `/etc/hosts` (requires sudo)
   - **Windows:** Edit `C:\Windows\System32\drivers\etc\hosts` (as Administrator)
   - Add this line: `127.0.0.1 mailarchive.local`

2. **Add to XAMPP Apache config:**
   - Open XAMPP's `httpd-vhosts.conf` (usually at `/Applications/XAMPP/etc/extra/httpd-vhosts.conf` on Mac or `C:\xampp\apache\conf\extra\httpd-vhosts.conf` on Windows)
   - Add this line at the end:
     ```apache
     Include "/Volumes/HubSSD/www/mailarchive/apache-mailarchive.conf"
     ```
   - Or copy the contents of `apache-mailarchive.conf` directly into `httpd-vhosts.conf`

3. **Ensure virtual hosts are enabled** in `httpd.conf`:
   ```apache
   Include etc/extra/httpd-vhosts.conf
   ```

4. **Restart Apache** in XAMPP Control Panel

5. **Access mailarchive at:** `http://mailarchive.local` (instead of `http://localhost/mailarchive`)

**Why this is safe:** The virtual host only applies to `http://mailarchive.local`. All your other apps (`http://localhost/ProjToolbox`, `http://localhost/blog`, etc.) are completely unaffected.

**If Authorization header doesn't work**, edit `apache-mailarchive.conf` and uncomment the alternative lines:
```apache
SetEnvIf Authorization "(.*)" HTTP_AUTHORIZATION=$1
RequestHeader set Authorization %{HTTP_AUTHORIZATION}e env=HTTP_AUTHORIZATION
```

### Option B: In .htaccess (scoped to mailarchive directory)

**A ready-to-use `.htaccess` file is included** in the project root. Use this if you prefer accessing mailarchive at `http://localhost/mailarchive/` instead of a virtual host.

**Steps:**

1. **Ensure `.htaccess` is in place:** It's already at `/Volumes/HubSSD/www/mailarchive/.htaccess`

2. **Enable mod_rewrite and mod_proxy** in `httpd.conf`:
   ```apache
   LoadModule rewrite_module modules/mod_rewrite.so
   LoadModule proxy_module modules/mod_proxy.so
   LoadModule proxy_http_module modules/mod_proxy_http.so
   LoadModule headers_module modules/mod_headers.so
   ```

3. **Allow .htaccess overrides** in your main Apache config (for the www directory):
   ```apache
   <Directory "/Volumes/HubSSD/www">
       AllowOverride All
       Require all granted
   </Directory>
   ```

4. **Access mailarchive at:** `http://localhost/mailarchive/`

**Why this is safe:** The `.htaccess` only affects requests to `/mailarchive/api/*`. Other apps like `/ProjToolbox/` or `/blog/` are unaffected.

**Note:** If you use this approach, you'll need to update OAuth redirect URIs to `http://localhost/mailarchive/api/microsoft/callback` (see section 3).

### Option C: Use a subdirectory to avoid conflicts

If other apps use `/api`, use `/mailarchive-api` instead:

**1. Update the UI** to use `/mailarchive-api` instead of `/api`:

In `web/vite.config.ts` (or build config), change the proxy path:

```ts
proxy: {
  "/mailarchive-api": {
    target: "http://127.0.0.1:3000",
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/mailarchive-api/, '/api'),
    // ... rest of config
  }
}
```

**2. In Apache**, proxy `/mailarchive-api`:

```apache
ProxyPass /mailarchive-api http://127.0.0.1:3000/api
ProxyPassReverse /mailarchive-api http://127.0.0.1:3000/api
RequestHeader set Authorization %{HTTP:Authorization}e
```

**3. Update OAuth redirect URIs** to use `/mailarchive-api` (e.g., `http://localhost/mailarchive-api/microsoft/callback`).

## 3. OAuth redirect URIs

When using Apache, the browser’s “origin” is your Apache URL (e.g. `http://mailarchive.local`). The OAuth **callback** still hits the Node API: either directly on port 3000 or via the same proxy.

- **If you proxy /api:** Callbacks are `http://mailarchive.local/api/microsoft/callback` and `http://mailarchive.local/api/gdrive/callback`. Register those **exact** URLs in Azure and Google (no port, same host as the UI).
- **If the API is only on port 3000:** Callbacks would be `http://localhost:3000/api/...`. Then in Azure/Google you must register `http://localhost:3000/api/microsoft/callback` and `http://localhost:3000/api/gdrive/callback`, and after login the user will be redirected to port 3000 (you may want to redirect them back to the UI in your callback handler).

For a single origin, prefer proxying `/api` through Apache and registering callbacks like `http://mailarchive.local/api/microsoft/callback`.

## 4. Environment

- Run the **Node API** (e.g. `npm run dev:api`) so it listens on `127.0.0.1:3000`.
- In production, set `MICROSOFT_REDIRECT_URI` and `GOOGLE_REDIRECT_URI` (and optionally `PORT`) to match the URL the browser uses (e.g. `http://mailarchive.local/api/microsoft/callback`).

## 5. Quick check

1. Open the UI in the browser (e.g. `http://mailarchive.local`).
2. Log in, then open DevTools → Network.
3. Click “Connect Google Drive” and select the request to `.../api/gdrive/connect`.
4. In Request Headers, confirm `Authorization: Bearer <token>` is present.
5. If the API still returns 401, check the API terminal for the `[auth] 401: authorization header present?` log to see whether the header reached Node.
