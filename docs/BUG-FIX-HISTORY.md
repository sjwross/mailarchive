# Bug / fix history (for records)

This document is a running log of bugs and fixes. It is for maintainer records; the main user-facing docs (README, TROUBLESHOOTING, etc.) are kept concise.

---

## Hosting / A2 (PostgreSQL and migrations)

**Issue:** `npm run db:migrate` on the server failed with:
- `no pg_hba.conf entry for host "127.0.0.1", user "mailarchive", database "mailarchive", SSL off`
- dotenv reported “injecting env (0)”.

**Fixes:**
- **`api/src/db.ts`** – When `DATABASE_URL` is set and contains `://`, the app now passes it as `connectionString` to the pg Pool so `?sslmode=require` works.
- **Root `package.json`** – `db:migrate` script changed from `dotenv -e .env` to `dotenv -e ./.env` so the project-root `.env` is used.
- **`docs/MIGRATION-TO-HOSTING.md`** – Section 3.2 updated with migration steps and SSL; §6 Troubleshooting added (pg_hba “SSL off”, “server does not support SSL”, “injecting env (0)”, Unix socket).
- **`.env.example`** – Comment added about `?sslmode=require` for hosting.

**Note:** On A2-style hosting, Postgres may still report “server does not support SSL” while pg_hba requires SSL; that requires a host-side fix (support ticket or different DB host).

---

## Local .env and API startup

**Issue:** After removing `.env` for hosting-only work, local API failed with `ClientAuthError: invalid_client_credential` and “injecting env (0)”.

**Fixes:**
- **Local `.env`** recreated in project root with dev defaults (DB, JWT, Microsoft/Google placeholders).
- **`api/src/lib/microsoft-auth.ts`** – MSAL client creation made **lazy** (only when Microsoft auth is used); no client at import so the API starts even without `MICROSOFT_CLIENT_SECRET`.

---

## Google Drive “Insufficient Permission”

**Issue:** Manual archive to Google Drive: Archived 0, Failed 50, first error “Insufficient Permission”.

**Cause:** Stored Drive token had old narrow scope; app now requests full `https://www.googleapis.com/auth/drive`.

**Fixes:**
- User must **disconnect and reconnect Google Drive** in Connections so a new token is issued.
- **`web/src/ui/RulesSection.tsx`** – When `firstError` contains “insufficient permission” and storage is gdrive, the alert appends a hint to reconnect Drive.

---

## “Run now” button not showing “Running…”

**Issue:** Button did not show loading state during archive run.

**Fix (in `web/src/ui/RulesSection.tsx`):**
- Added state `runningRuleId` and set/clear in `runNow` (with `finally`).
- Button shows “Running…” and is disabled when `runningRuleId === rule.id`.
- Used **`flushSync`** from `react-dom` plus **`setTimeout(0)`** so the “Running…” state is committed and painted before the long `fetch`, so the button updates reliably.

---

## Archive-delete: emails not in Deleted folder

**Issue:** archive-delete was “working” but user expected to see deleted emails in their **Deleted Items** folder; they were not there.

**Cause:** The app used Microsoft Graph’s **delete** API. That is a soft delete, but depending on tenant/Outlook behavior the message can end up in a recoverable layer and not show in the normal Deleted Items folder.

**Fix (in `api/src/lib/archive.ts`):**
- For **archive_delete**, the app now **moves** the message to the **Deleted Items** folder (same as Junk cleanup) instead of calling delete.
- Resolve Deleted Items with `getWellKnownFolder(client, accountId, "deleteditems")` and call `moveMessage(..., deletedFolderId)`.
- Removed use of `deleteMessage` for archive-delete; if Deleted Items folder cannot be resolved, log a warning and skip the move.

---

## Redeploy (local)

To pick up code changes locally, restart the API:

```bash
npm run dev -w api
```

Or from repo root: `npm run dev:api`. If the API is already running, stop it (Ctrl+C) and start again.
