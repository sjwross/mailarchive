# Quick Setup Guide for XAMPP

## Summary

Your mailarchive app is at `/Volumes/HubSSD/www/mailarchive/` alongside other apps (ProjToolbox, blog, academy-clean, etc.). 

**✅ SAFE:** The configuration below **will NOT affect** your other apps because it uses a separate virtual host.

## Quick Start (Recommended: Virtual Host)

### Step 1: Add to hosts file

**Mac/Linux:**
```bash
sudo nano /etc/hosts
```

**Windows:**
Edit `C:\Windows\System32\drivers\etc\hosts` (as Administrator)

Add this line:
```
127.0.0.1 mailarchive.local
```

### Step 2: Add Apache virtual host

**Mac:** Open `/Applications/XAMPP/etc/extra/httpd-vhosts.conf`  
**Windows:** Open `C:\xampp\apache\conf\extra\httpd-vhosts.conf`

Add this line at the end:
```apache
Include "/Volumes/HubSSD/www/mailarchive/apache-mailarchive.conf"
```

Or copy the entire contents of `apache-mailarchive.conf` directly into `httpd-vhosts.conf`.

### Step 3: Ensure virtual hosts are enabled

In `httpd.conf`, make sure this line is uncommented:
```apache
Include etc/extra/httpd-vhosts.conf
```

### Step 4: Build the web UI

```bash
cd /Volumes/HubSSD/www/mailarchive
npm run build
```

### Step 5: Update OAuth redirect URIs

Edit `.env` and change:
```
MICROSOFT_REDIRECT_URI=http://mailarchive.local/api/microsoft/callback
GOOGLE_REDIRECT_URI=http://mailarchive.local/api/gdrive/callback
```

Then register these URLs in:
- **Azure AD:** App registration → Authentication → Add redirect URI
- **Google Cloud Console:** OAuth 2.0 Client → Authorized redirect URIs

### Step 6: Restart Apache

In XAMPP Control Panel, restart Apache.

### Step 7: Access mailarchive

Open `http://mailarchive.local` in your browser.

---

## Alternative: Use .htaccess (if you prefer localhost/mailarchive)

If you want to access mailarchive at `http://localhost/mailarchive/` instead:

1. The `.htaccess` file is already in place at `/Volumes/HubSSD/www/mailarchive/.htaccess`
2. Ensure `mod_rewrite` and `mod_proxy` are enabled in `httpd.conf`
3. Update `.env` redirect URIs to:
   ```
   MICROSOFT_REDIRECT_URI=http://localhost/mailarchive/api/microsoft/callback
   GOOGLE_REDIRECT_URI=http://localhost/mailarchive/api/gdrive/callback
   ```
4. Register these URLs in Azure/Google
5. Access at `http://localhost/mailarchive/`

---

## Why This Is Safe

- **Virtual host approach:** Only affects `http://mailarchive.local`. Your other apps (`http://localhost/ProjToolbox`, `http://localhost/blog`, etc.) are completely unaffected.
- **.htaccess approach:** Only affects `/mailarchive/api/*`. Other apps are unaffected.

---

## Troubleshooting

**"Missing or invalid Authorization header" error:**
- Check that `mod_headers` is enabled in `httpd.conf`
- If Authorization header still doesn't work, edit `apache-mailarchive.conf` and uncomment the alternative lines:
  ```apache
  SetEnvIf Authorization "(.*)" HTTP_AUTHORIZATION=$1
  RequestHeader set Authorization %{HTTP_AUTHORIZATION}e env=HTTP_AUTHORIZATION
  ```

**OAuth redirects fail:**
- Make sure the redirect URIs in `.env` match exactly what's registered in Azure/Google
- Make sure the Node API is running (`npm run dev:api`)

**Can't access mailarchive.local:**
- Check `/etc/hosts` (Mac) or `C:\Windows\System32\drivers\etc\hosts` (Windows) has `127.0.0.1 mailarchive.local`
- Check that virtual hosts are enabled in `httpd.conf`
