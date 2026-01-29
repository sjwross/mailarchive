# Next feature: Archive email browser (Google Drive)

**Status:** Planned (not yet implemented)

## Goal

- **Browse** archived emails stored on Google Drive using the existing folder hierarchy (`mailarchive / {userId} / {OutlookFolder} / {year} / {month} / .eml files`).
- **Download** individual `.eml` files from the browser.

## Scope

- **Google Drive only** (no S3 browser in this feature).
- Shown only when the user is logged in and Google Drive is connected.

## Backend (API)

New endpoints under existing gdrive auth:

| Endpoint | Purpose |
|----------|--------|
| `GET /api/gdrive/archive/list` | List root of the user’s archive (children of `mailarchive/{userId}`), e.g. Inbox, Sent Items. |
| `GET /api/gdrive/archive/list?folderId=xxx` | List direct children of `folderId` (subfolders and/or `.eml` files) for drill-down. |
| `GET /api/gdrive/archive/files/:fileId` | Download one file: stream with `Content-Type: message/rfc822` and `Content-Disposition: attachment`. |

- Reuse `getDriveForUser(userId)` and `config.rootFolderId`. Resolve user’s archive root, then use Drive `files.list` (by parent) and `files.get` with `alt: 'media'` for download.
- Response shape for list: `{ folders: [ { id, name } ], files: [ { id, name, modifiedTime } ] }`.

## Frontend (Web)

- New section **“Browse archive”** (e.g. below Archive Rules), visible only when Google Drive is connected.
- **Breadcrumb:** e.g. `Archive > Inbox > 2025 > 01`; each segment navigates back to that level.
- **List:** Folders (click to drill down) and `.eml` files with a **Download** link (`GET /api/gdrive/archive/files/:fileId`).
- v1: Show filename only (no parsing of `.eml` for subject/date in the list).

## Implementation order

1. API: add list (root + by `folderId`) and download-by-`fileId` in gdrive lib/routes.
2. Web: add “Browse archive” section with breadcrumb, list, and download links.

## References

- Storage layout: [TROUBLESHOOTING.md](TROUBLESHOOTING.md) — “Storage layout in Google Drive”.
- Existing gdrive: `api/src/lib/google-drive.ts`, `api/src/routes/gdrive.ts`.
