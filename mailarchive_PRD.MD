# CloudMail Archive — Product Requirements Document (PRD)

## Product Vision

CloudMail Archive helps users **free up storage space in their Outlook.com mailbox** by automatically archiving older emails to their preferred cloud storage, then safely removing those emails from Outlook once archived.

The product prioritizes:
- Data ownership (users control their storage destination)
- Safety (no email is deleted unless archived and verified)
- Simplicity (set rules once, run automatically)

---

## Problem Statement

Outlook.com users have limited mailbox storage. Many users:
- Accumulate years of old email and large attachments
- Do not want to manually download and manage archives
- Don't trust deleting emails without a safe backup

There is no simple tool that:
1. Automatically exports full-fidelity email archives
2. Stores them in the user's own cloud storage
3. Then deletes the originals to reclaim mailbox space

---

## Goals

### Primary Goal
Reduce a user's Outlook.com mailbox storage usage **safely and automatically**.

### Secondary Goals
- Support multiple cloud storage providers
- Make archiving understandable and reversible (from archive copy)
- Build a system that can scale to many users (SaaS model)

---

## Non-Goals (V1)

- Not a full email client
- Not real-time backup of every new email
- No restore-to-Outlook feature in V1
- No on-prem/self-hosted version in V1

---

## Target Users

### Primary
Individuals using Outlook.com who:
- Are hitting storage limits
- Want to keep old mail but not inside Outlook

### Secondary (future)
Small businesses using Microsoft accounts who want low-cost long-term archiving

---

## High-Level User Flow

1. User creates account on CloudMail Archive
2. User connects their **Microsoft (Outlook.com)** account
3. User connects their **cloud storage** (Drive/Dropbox/S3/etc.)
4. User defines archive rule (example: "Archive mail older than 1 year")
5. System runs archive job:
   - Downloads email as `.eml`
   - Uploads to user's storage
   - Verifies upload
   - Deletes email from Outlook (based on selected safety mode)
6. User sees storage reduction over time

---

## Core Features (V1)

### 1. Microsoft Account Connection
**Description:** Users connect Outlook.com via Microsoft OAuth.

**Requirements**
- Use Microsoft Graph API
- Request mail read + delete permissions
- Securely store and refresh tokens

---

### 2. Cloud Storage Connection (BYO Storage Model)

**Description:** Users connect their own cloud storage where archives are saved.

**V1 Target**
- S3-compatible storage (AWS S3, Backblaze B2 S3, Cloudflare R2, etc.)

**Future**
- Google Drive
- Dropbox
- OneDrive

**Requirements**
- User provides credentials or OAuth depending on provider
- Credentials encrypted at rest

---

### 3. Archive Rules

Users can define:

| Setting | Description |
|--------|-------------|
| Age Threshold | Archive emails older than X days/months/years |
| Folders | Select which folders (Inbox, Sent, custom folders) |
| Safety Mode | Archive Only / Archive + Move / Archive + Delete (see Cleanup Actions below) |
| Schedule | Manual / Daily / Weekly |

**Note on Archive + Move:** "Move" means moving the message to a user-chosen folder *within Outlook* (e.g. an "Archived" folder), not moving the file in cloud storage. The `.eml` copy is already in the user's cloud; the Outlook copy is relocated so the user can still see it in Outlook if desired.

---

### 4. Email Archiving Engine

For each email selected by rules:

1. Fetch message metadata from Microsoft Graph
2. Download full MIME content (`.eml` format)
3. Upload `.eml` file to user's cloud storage
4. Verify upload success
5. If verification passes → perform cleanup action

#### Storage Format

- **File format:** Full MIME content stored as a single `.eml` file per message (readable by any email client).
- **Path convention:** `{bucket}/{user_id}/{folder_name}/{year}/{month}/` (e.g. `my-bucket/usr_abc123/Inbox/2024/03/`).
- **Filename:** Use a stable identifier such as message-id (sanitized) or `{date}_{subject_hash}.eml` to avoid collisions and allow idempotent re-runs.

#### Cleanup Actions

Behavior after a successful upload and verification:

| Safety Mode | Behavior |
|-------------|----------|
| **Archive Only** | Upload only; no change to the message in Outlook. |
| **Archive + Move** | After verification, move the message in Outlook to a user-selected folder (e.g. "Archived") via Graph move API. |
| **Archive + Delete** | After verification, permanently delete the message from Outlook via Graph delete API. |

No cleanup action (move or delete) is performed unless the upload has been verified.

#### Verification

- Require a successful upload response from the storage provider.
- Optionally confirm the object exists (e.g. HEAD or GET) and, if desired, validate size or checksum before performing any cleanup.
- If verification fails: do not move or delete the message; log the failure and surface to the user (e.g. job report or alert).

#### Rate Limits and Batching

- Microsoft Graph applies throttling; implement backoff and retry for transient errors.
- Process messages in bounded batches per run (e.g. 100–500 messages) to limit run duration and allow progress reporting.
- Respect storage provider rate limits when uploading.

---

## Success Metrics (V1)

- **Mailbox storage freed:** Aggregate bytes (or equivalent) freed per user over time.
- **Archived message count:** Number of messages successfully archived per user/job.
- **Verification failures:** Count of uploads that did not pass verification; no delete/move occurs for these — monitor and alert so users can investigate.

---

## Security and Compliance

- Tokens and cloud storage credentials are encrypted at rest.
- Message content is either processed and discarded after upload or stored only in the user's own bucket; the service does not retain message body or attachments beyond what is necessary for the archive operation.

---

## Appendix: Restore (Out of Scope for V1)

In V1 there is no "restore to Outlook" feature. Users can restore by downloading `.eml` files from their cloud storage and re-importing into Outlook or another client via that client's import functionality.
