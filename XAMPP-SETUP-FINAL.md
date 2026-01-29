# XAMPP Setup - Final Configuration

## How It Works

**UI:** Served via Apache virtual host at `http://mailarchive.local`
- All `/api/*` requests from the UI are proxied through Apache to Node.js on port 3000
- Authorization headers are forwarded correctly

**OAuth Callbacks:** Go directly to `http://localhost:3000/api/...`
- Google and Microsoft OAuth don't accept `.local` domains
- They DO accept `localhost:PORT` for local development
- After OAuth completes, you'll be redirected to `localhost:3000` (this is fine)

## Current Configuration

✅ **`.env` updated:** OAuth redirect URIs use `localhost:3000`
✅ **Apache virtual host:** Configured for `mailarchive.local`
✅ **Web UI:** Built and ready
✅ **Virtual hosts:** Enabled in Apache

## OAuth Redirect URIs to Register

**Azure AD:**
- `http://localhost:3000/api/microsoft/callback`

**Google Cloud Console:**
- `http://localhost:3000/api/gdrive/callback`

**Note:** These go directly to Node.js (bypassing Apache), which is allowed by OAuth providers for local development.

## Access Points

- **Web UI:** `http://mailarchive.local` (via Apache)
- **API directly:** `http://localhost:3000/api/...` (for OAuth callbacks)
- **Other apps:** `http://localhost/ProjToolbox`, `http://localhost/blog`, etc. (unaffected)

## Testing

1. **Start Node API:**
   ```bash
   npm run dev:api
   ```

2. **Restart Apache** in XAMPP Control Panel

3. **Open:** `http://mailarchive.local`

4. **Test OAuth:**
   - Click "Connect Microsoft" or "Connect Google Drive"
   - You'll be redirected to the OAuth provider
   - After authorization, you'll be redirected to `localhost:3000/api/...`
   - The callback will complete and you can return to `mailarchive.local`

## Why This Works

- **UI isolation:** Virtual host keeps mailarchive separate from other apps
- **OAuth compatibility:** Using `localhost:3000` satisfies OAuth provider requirements
- **API proxying:** Regular API calls from UI go through Apache with proper headers
- **No conflicts:** Other apps remain completely unaffected
