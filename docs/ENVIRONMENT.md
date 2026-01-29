# Environment Variables

## Required

### DATABASE_URL

PostgreSQL connection string.

**Format:**
```
postgres://user:password@host:port/database
```

**Example:**
```
DATABASE_URL=postgres://mailarchive:mailarchive@localhost:5432/mailarchive
```

**Alternative:** Use individual parameters (see Database.md)

### JWT_SECRET

Secret key for signing JWT tokens. Use a strong random value in production.

**Example:**
```
JWT_SECRET=your-secret-key-here-change-in-production
```

### REDIS_URL

Redis connection URL for BullMQ job queue.

**Format:**
```
redis://host:port
```

**Example:**
```
REDIS_URL=redis://localhost:6379
```

## Optional

### PORT

API server port. Default: `3000`

**Example:**
```
PORT=3000
```

### Microsoft OAuth (Phase 2)

Required for Microsoft account integration.

#### MICROSOFT_CLIENT_ID

Azure AD application (client) ID.

**Get from:** Azure Portal → Azure Active Directory → App registrations → Your app → Overview

**Example:**
```
MICROSOFT_CLIENT_ID=12345678-1234-1234-1234-123456789abc
```

#### MICROSOFT_CLIENT_SECRET

Azure AD application client secret.

**Get from:** Azure Portal → Azure Active Directory → App registrations → Your app → Certificates & secrets

**Example:**
```
MICROSOFT_CLIENT_SECRET=your-secret-value
```

#### MICROSOFT_TENANT_ID

Azure AD tenant ID. Use `common` for multi-tenant or your tenant ID for single-tenant.

**Example:**
```
MICROSOFT_TENANT_ID=common
```

#### MICROSOFT_REDIRECT_URI

OAuth redirect URI. Must match the redirect URI configured in Azure AD.

**Example:**
```
MICROSOFT_REDIRECT_URI=http://localhost:3000/api/microsoft/callback
```

### Encryption

#### ENCRYPTION_KEY

Key for encrypting stored tokens and connection credentials. Use a strong random value in production.

**Example:**
```
ENCRYPTION_KEY=your-32-character-encryption-key

### Google Drive (optional, Phase 3+)

Required to use Google Drive as a storage provider.

#### GOOGLE_CLIENT_ID

Google OAuth client ID (Web application).

#### GOOGLE_CLIENT_SECRET

Google OAuth client secret.

#### GOOGLE_REDIRECT_URI

Redirect URI configured in Google Cloud Console. For local dev:

```bash
GOOGLE_REDIRECT_URI=http://localhost:3000/api/gdrive/callback
```

### S3 (optional, Phase 3)

Per-user S3 configuration is stored encrypted in the database. You can optionally provide default values for local development:

```bash
# Optional defaults for local dev (not used in production by default)
S3_DEFAULT_ENDPOINT=https://s3.us-east-1.amazonaws.com
S3_DEFAULT_REGION=us-east-1
S3_DEFAULT_BUCKET=your-default-bucket
```

Each user then configures their own S3 connection via the `/api/storage/s3` endpoint.
```

### Cron (optional, Phase 5)

Used to secure the `/api/jobs/run-scheduled` endpoint when called from a cron job.

#### CRON_SECRET

Shared secret used by cron to authenticate.

**Example:**
```bash
CRON_SECRET=your-strong-cron-secret
```


## Example .env File

```bash
# PostgreSQL
DATABASE_URL=postgres://mailarchive:mailarchive@localhost:5432/mailarchive

# JWT
JWT_SECRET=test-secret-for-phase1-testing

# Redis
REDIS_URL=redis://localhost:6379

# API Port
PORT=3000
```

## Production Considerations

- Use strong, randomly generated `JWT_SECRET`
- Use secure database credentials
- Consider using connection pooling parameters
- Set appropriate `PORT` for your hosting environment
- Store secrets securely (environment variables, secret management service)
