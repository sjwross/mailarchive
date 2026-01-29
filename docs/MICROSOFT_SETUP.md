# Microsoft Azure AD Setup Guide

This guide walks through setting up an Azure AD application for Microsoft OAuth integration.

## Prerequisites

- Microsoft Azure account
- Access to Azure Portal

## Step 1: Create App Registration

1. Go to [Azure Portal](https://portal.azure.com)
2. Navigate to **Azure Active Directory** → **App registrations**
3. Click **New registration**
4. Fill in:
   - **Name**: `mailarchive` (or your preferred name)
   - **Supported account types**: 
     - For personal Microsoft accounts: **Personal Microsoft accounts only**
     - For work/school accounts: **Accounts in any organizational directory**
     - For both: **Accounts in any organizational directory and personal Microsoft accounts**
   - **Redirect URI**: 
     - Platform: **Web**
     - URI: `http://localhost:3000/api/microsoft/callback` (for local dev)
     - For production, add your production URL
5. Click **Register**

## Step 2: Get Client ID and Tenant ID

After registration:

1. **Client ID**: Found on the **Overview** page (copy this value)
2. **Tenant ID**: Found on the **Overview** page under "Directory (tenant) ID" (copy this value, or use `common` for multi-tenant)

## Step 3: Create Client Secret

1. Go to **Certificates & secrets** in the left menu
2. Click **New client secret**
3. Fill in:
   - **Description**: `mailarchive secret` (or your description)
   - **Expires**: Choose expiration (6 months, 12 months, or never)
4. Click **Add**
5. **Important**: Copy the secret **value** immediately (it won't be shown again)
   - This is your `MICROSOFT_CLIENT_SECRET`

## Step 4: Configure API Permissions

1. Go to **API permissions** in the left menu
2. Click **Add a permission**
3. Select **Microsoft Graph**
4. Select **Delegated permissions**
5. Add the following **Delegated** permissions:
   - `User.Read` - Sign in and read user profile (needed for `/me` and email)
   - `Mail.Read` - Read user mail
   - `Mail.ReadWrite` - Read and write user mail
   - `offline_access` - Maintain access (refresh token)
6. Click **Add permissions**
7. Click **Grant admin consent** (if you're an admin) to grant permissions for all users

## Step 5: Update Environment Variables

Add to your `.env` file:

```bash
MICROSOFT_CLIENT_ID=your-client-id-from-step-2
MICROSOFT_CLIENT_SECRET=your-client-secret-from-step-3
MICROSOFT_TENANT_ID=common
MICROSOFT_REDIRECT_URI=http://localhost:3000/api/microsoft/callback
ENCRYPTION_KEY=your-32-character-encryption-key
```

## Step 6: Test Connection

1. Start your API: `npm run dev:api`
2. Register/login to get a JWT token
3. Call `GET /api/microsoft/connect` with your token
4. Open the returned `authUrl` in a browser
5. Sign in with your Microsoft account
6. Grant permissions
7. You should be redirected back to your callback URL

## Production Considerations

- Use a strong `ENCRYPTION_KEY` (32+ characters, random)
- Add production redirect URI in Azure AD
- Update `MICROSOFT_REDIRECT_URI` to your production URL
- Consider using a specific tenant ID instead of `common` for better security
- Rotate client secrets regularly
- Monitor API usage in Azure Portal

## Troubleshooting

### "Invalid client" error
- Verify `MICROSOFT_CLIENT_ID` matches the Application (client) ID in Azure Portal

### "Invalid client secret" error
- Verify `MICROSOFT_CLIENT_SECRET` is correct (secrets expire)
- Create a new secret if expired

### "Redirect URI mismatch" error
- Ensure the redirect URI in Azure AD exactly matches `MICROSOFT_REDIRECT_URI`
- Check for trailing slashes, http vs https, etc.

### "OAuth error: invalid_request"
- See **[Verify Azure setup (invalid_request)](#verify-azure-setup-invalid_request)** below for a step-by-step checklist.
- After the API change, the callback now returns Microsoft’s `error_description` in the JSON; check that message for the exact cause.

### "Insufficient privileges" error
- Verify API permissions are granted
- Check that admin consent was granted (if required)

---

## Verify Azure setup (invalid_request)

Use this checklist when you see `{"error":"OAuth error: invalid_request"}`. The app sends **exactly** these values; Azure must match them.

**Values your app uses** (from `.env` and code):

| Setting        | App value |
|----------------|-----------|
| Redirect URI   | `http://localhost:3000/api/microsoft/callback` |
| Client ID      | `4c24c661-e708-4e8b-94da-205b48d82494` |
| Tenant ID      | `cc7312ca-599d-4e5f-b455-863356f48151` |
| Authority URL  | `https://login.microsoftonline.com/cc7312ca-599d-4e5f-b455-863356f48151` |
| Scopes (Graph) | `User.Read`, `Mail.Read`, `Mail.ReadWrite`, `offline_access` |

### 1. App registration and IDs

1. Go to [Azure Portal](https://portal.azure.com) → **Microsoft Entra ID** (or **Azure Active Directory**) → **App registrations**.
2. Open the app named **mailarchive** (or the one you use).
3. On **Overview**:
   - **Application (client) ID** must be exactly:  
     `4c24c661-e708-4e8b-94da-205b48d82494`  
     (Same as `MICROSOFT_CLIENT_ID` in `.env`.)
   - **Directory (tenant) ID** must be exactly:  
     `cc7312ca-599d-4e5f-b455-863356f48151`  
     (Same as `MICROSOFT_TENANT_ID` in `.env`. If you use `common` in `.env`, tenant here can differ; the app will use `common` in the authority.)

### 2. Authentication → Redirect URI (most common cause of invalid_request)

1. In the app, go to **Authentication**.
2. Under **Platform configurations**, select the **Web** platform (not SPA).
3. Under **Redirect URIs**, you must have **exactly**:
   - `http://localhost:3000/api/microsoft/callback`
4. Check:
   - `http` (not `https`)
   - `localhost` (not `127.0.0.1` or `mailarchive.local`)
   - Port `3000`
   - Path `/api/microsoft/callback` (no trailing slash, correct casing)
5. If you use a different redirect in production, add it as an **additional** URI; keep this one for local.
6. Click **Save**.

### 3. Authentication → Supported account types

1. Still under **Authentication**, find **Supported account types**.
2. If you sign in with a **personal Microsoft account** (e.g. Outlook.com), choose:
   - **Accounts in any organizational directory and personal Microsoft accounts**
3. If it’s set to “Accounts in this organizational directory only”, a personal account will get `invalid_request` or similar. Change it or use a work/school account that belongs to that directory.
4. Click **Save** if you changed anything.

### 4. API permissions

1. Go to **API permissions**.
2. Under **Configured permissions**, for **Microsoft Graph** you should see these **Delegated** permissions:
   - `User.Read`
   - `Mail.Read`
   - `Mail.ReadWrite`
   - `offline_access`
3. If any are missing: **Add a permission** → **Microsoft Graph** → **Delegated** → add the missing ones.
4. Check **Status**:
   - **Granted for [Your tenant]** = OK.
   - **Not granted** = either each user consents at sign-in (for User.Read, Mail.*, offline_access that’s often OK), or an admin must grant consent.
5. If you’re testing with a **personal Microsoft account**, “Grant admin consent” may be greyed out; that’s normal. Consent happens when the user signs in.
6. Click **Save** if you added permissions.

### 5. Certificates & secrets

1. Go to **Certificates & secrets**.
2. Under **Client secrets**, confirm there is at least one secret and that it **Expires** in the future.
3. The **Value** is only shown when the secret is created. If you’re unsure:
   - Add a **New client secret**, copy the value, put it in `.env` as `MICROSOFT_CLIENT_SECRET`, then restart the API.
4. Remove old secrets after switching to the new one if you want to avoid confusion.

### 6. After changing Azure

1. Restart the Node API: `npm run dev -w api` (or your usual command).
2. Try “Connect Microsoft account” again from the app (e.g. `http://mailarchive.local`).
3. If it still fails, the API now returns Microsoft’s `error_description` in the JSON, e.g.:  
   `{"error":"OAuth error: invalid_request — &lt;description&gt;"}`  
   Use that text to narrow down the problem (e.g. redirect_uri, client_id, scope).

### 7. Optional: capture the exact error from Microsoft

When the error happens, Microsoft redirects the browser to your callback with query parameters. You can capture the full URL:

1. In the browser, when you see the error page, look at the address bar.
2. Or in DevTools (F12) → **Network**, find the request to `/api/microsoft/callback` and check its **Request URL** (query string will contain `error` and often `error_description`).

That URL shows the exact `error` and `error_description` Microsoft returns, which helps confirm redirect URI, scope, or account type issues.
