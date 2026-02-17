# API Documentation

## Base URL

- Local: `http://localhost:3000`
- Production: TBD

## Authentication

Most endpoints require a JWT token in the `Authorization` header:

```
Authorization: Bearer <token>
```

Tokens are obtained via `/api/auth/register` or `/api/auth/login` and expire after 7 days.

## Endpoints

### Health

**GET** `/api/health`

No authentication required.

**Response:**
```json
{ "ok": true }
```

### Authentication

#### Register

**POST** `/api/auth/register`

**Body:**
```json
{
  "email": "user@example.com",
  "password": "securepassword"
}
```

**Response:**
```json
{
  "token": "eyJhbGci...",
  "user": {
    "id": "user_id",
    "email": "user@example.com"
  }
}
```

**Errors:**
- `400` - Missing email or password
- `409` - Email already registered

#### Login

**POST** `/api/auth/login`

**Body:**
```json
{
  "email": "user@example.com",
  "password": "securepassword"
}
```

**Response:** Same as register.

**Errors:**
- `400` - Missing email or password
- `401` - Invalid email or password

### Connections

Connections represent cloud storage providers (S3, etc.) where archives are stored.

#### List Connections

**GET** `/api/connections`

**Response:**
```json
{
  "connections": [
    {
      "id": "conn_id",
      "provider": "s3",
      "created_at": "2026-01-28T18:00:00Z"
    }
  ]
}
```

#### Create Connection

**POST** `/api/connections`

**Body:**
```json
{
  "provider": "s3"
}
```

**Response:**
```json
{
  "id": "conn_id",
  "user_id": "user_id",
  "provider": "s3"
}
```

#### Get Connection

**GET** `/api/connections/:id`

**Response:** Connection object (same as create).

**Errors:**
- `404` - Connection not found

#### Delete Connection

**DELETE** `/api/connections/:id`

**Response:** `204 No Content`

**Errors:**
- `404` - Connection not found

### Rules

Rules define what emails to archive and when.

#### List Rules

**GET** `/api/rules`

**Response:**
```json
{
  "rules": [
    {
      "id": "rule_id",
      "name": "Archive old mail",
      "age_threshold_days": 365,
      "folder_ids": ["inbox", "sent"],
      "safety_mode": "archive_only",
      "schedule": "weekly",
      "created_at": "2026-01-28T18:00:00Z"
    }
  ]
}
```

#### Create Rule

**POST** `/api/rules`

**Body:**
```json
{
  "name": "Archive old mail",
  "age_threshold_days": 365,
  "folder_ids": ["inbox"],
  "safety_mode": "archive_only",
  "schedule": "manual"
}
```

**Fields:**
- `name` (required) - Rule name
- `age_threshold_days` (required) - Archive emails older than N days
- `folder_ids` (optional) - Array of folder IDs to process (default: `[]`)
- `safety_mode` (optional) - `archive_only` | `archive_move` | `archive_delete` (default: `archive_only`). `archive_move` moves messages to the Outlook Archive folder after archiving; `archive_delete` moves them to Deleted Items (not permanent delete).
- `schedule` (optional) - `manual` | `daily` | `weekly` (default: `manual`)

**Response:** Rule object (same as list).

#### Get Rule

**GET** `/api/rules/:id`

**Response:** Rule object.

**Errors:**
- `404` - Rule not found

#### Update Rule

**PATCH** `/api/rules/:id`

**Body:** Same as create, all fields optional.

**Response:** Updated rule object.

**Errors:**
- `404` - Rule not found

#### Delete Rule

**DELETE** `/api/rules/:id`

**Response:** `204 No Content`

**Errors:**
- `404` - Rule not found

#### Run Rule Now

**POST** `/api/rules/:id/run-now`

Run the archive engine immediately for the specified rule and the authenticated user.

**Response (success):**
```json
{
  "ok": true,
  "summary": {
    "ruleId": "rule_id",
    "processedFolders": ["folder_id"],
    "totalMessagesConsidered": 10,
    "totalArchived": 8,
    "totalFailed": 2,
    "safetyMode": "archive_only"
  }
}
```

**Errors:**
- `400` - Rule not found for user, Microsoft not connected, or S3 storage not configured

---

## Jobs (Scheduling) — Phase 5

### Run Scheduled Rules

**POST** `/api/jobs/run-scheduled`

Intended to be called from a cron job. Finds all rules with `schedule != "manual"`, checks whether they are due (daily/weekly), and runs the archive engine for them.

**Authentication:** Uses a shared secret header:

```http
X-Cron-Secret: <CRON_SECRET>
```

**Response:**
```json
{
  "ok": true,
  "summaries": [
    {
      "ruleId": "rule_id",
      "userId": "user_id",
      "schedule": "daily",
      "ran": true
    },
    {
      "ruleId": "other_rule",
      "userId": "user_id",
      "schedule": "weekly",
      "ran": false,
      "error": "Microsoft account not connected"
    }
  ]
}
```

---

## Storage (S3-compatible) — Phase 3

### Configure S3 Connection

**POST** `/api/storage/s3`

Create a new S3 storage connection for the authenticated user.

**Body:**
```json
{
  "endpoint": "https://s3.us-east-1.amazonaws.com", // optional, required for non-AWS S3
  "region": "us-east-1",
  "accessKeyId": "YOUR_ACCESS_KEY_ID",
  "secretAccessKey": "YOUR_SECRET_ACCESS_KEY",
  "bucket": "your-bucket-name",
  "basePath": "mailarchive/" // optional
}
```

**Response:**
```json
{
  "id": "conn_id",
  "provider": "s3",
  "bucket": "your-bucket-name",
  "region": "us-east-1",
  "basePath": "mailarchive/"
}
```

**Errors:**
- `400` - Missing required fields

### Get S3 Configuration

**GET** `/api/storage/s3`

Return non-sensitive information about the current S3 configuration for the user.

**Response (configured):**
```json
{
  "configured": true,
  "region": "us-east-1",
  "bucket": "your-bucket-name",
  "basePath": "mailarchive/",
  "hasCredentials": true
}
```

**Response (not configured):**
```json
{
  "configured": false
}
```

### Test S3 Connection

**POST** `/api/storage/s3/test`

Uploads a small test object to verify S3 credentials and bucket configuration.

**Response (success):**
```json
{
  "ok": true,
  "bucket": "your-bucket-name",
  "key": "mailarchive/..."
}
```

**Errors:**
- `404` - S3 storage not configured
- `500` - Upload failed (error details in `error` / `errorType`)

### Microsoft Integration (Phase 2)

#### Connect Microsoft Account

**GET** `/api/microsoft/connect`

Initiates OAuth flow. Returns authorization URL.

**Response:**
```json
{
  "authUrl": "https://login.microsoftonline.com/...",
  "state": "state_token"
}
```

**Next Steps:** Redirect user to `authUrl`. After authorization, Microsoft redirects to `/api/microsoft/callback`.

#### OAuth Callback

**GET** `/api/microsoft/callback?code=...&state=...`

Handles OAuth callback from Microsoft. Stores encrypted tokens.

**Response:**
```json
{
  "success": true,
  "connectionId": "conn_id",
  "email": "user@outlook.com"
}
```

**Errors:**
- `400` - Missing code/state or OAuth error
- `500` - Failed to complete OAuth flow

#### List Folders

**GET** `/api/microsoft/folders`

Lists all mail folders for the connected Microsoft account.

**Response:**
```json
{
  "folders": [
    {
      "id": "folder_id",
      "displayName": "Inbox",
      "childFolderCount": 0
    }
  ]
}
```

**Errors:**
- `404` - Microsoft account not connected
- `500` - Failed to list folders

#### Connection Status

**GET** `/api/microsoft/status`

Check if Microsoft account is connected and get connection details.

**Response:**
```json
{
  "connected": true,
  "email": "user@outlook.com",
  "expiresAt": 1234567890000,
  "connectionId": "conn_id"
}
```

Or if not connected:
```json
{
  "connected": false
}
```
