# Database Schema

All tables use the `mailarchive_` prefix to allow sharing a database with other applications.

## Tables

### mailarchive_users

User accounts for the application.

| Column | Type | Description |
|--------|------|-------------|
| id | VARCHAR(22) | Primary key (nanoid) |
| email | VARCHAR(255) | Unique email address |
| password_hash | VARCHAR(255) | Bcrypt hash of password |
| created_at | TIMESTAMPTZ | Account creation timestamp |

**Indexes:**
- Primary key on `id`
- Unique index on `email`

### mailarchive_connections

Cloud storage connections (S3, etc.) where archives are stored.

| Column | Type | Description |
|--------|------|-------------|
| id | VARCHAR(22) | Primary key (nanoid) |
| user_id | VARCHAR(22) | Foreign key to `mailarchive_users.id` |
| provider | VARCHAR(50) | Provider name (e.g., "s3") |
| config_encrypted | TEXT | Encrypted connection config (credentials, etc.) |
| created_at | TIMESTAMPTZ | Connection creation timestamp |

**Indexes:**
- Primary key on `id`
- Index on `user_id`
- Foreign key: `user_id` → `mailarchive_users(id)` ON DELETE CASCADE

### mailarchive_rules

Archive rules defining what emails to archive and when.

| Column | Type | Description |
|--------|------|-------------|
| id | VARCHAR(22) | Primary key (nanoid) |
| user_id | VARCHAR(22) | Foreign key to `mailarchive_users.id` |
| name | VARCHAR(255) | Rule name |
| age_threshold_days | INTEGER | Archive emails older than N days |
| folder_ids | JSONB | Array of folder IDs to process |
| safety_mode | VARCHAR(20) | `archive_only`, `archive_move`, or `archive_delete` |
| schedule | VARCHAR(20) | `manual`, `daily`, or `weekly` |
| created_at | TIMESTAMPTZ | Rule creation timestamp |

**Indexes:**
- Primary key on `id`
- Index on `user_id`
- Foreign key: `user_id` → `mailarchive_users(id)` ON DELETE CASCADE

## Migrations

Migrations are stored in `api/migrations/` and use `node-pg-migrate` format.

**Note:** Due to a known issue with `node-pg-migrate` password parsing, we use a custom migration script (`api/scripts/run-migration.ts`) that uses the `pg` library directly.

**Run migrations:**
```bash
npm run db:migrate
# Or manually:
cd api && npx tsx scripts/run-migration.ts
```

## Connection String Format

The application supports both connection string and individual parameters:

**Connection String:**
```
DATABASE_URL=postgres://user:password@host:port/database
```

**Individual Parameters:**
```
DB_HOST=localhost
DB_PORT=5432
DB_NAME=mailarchive
DB_USER=mailarchive
DB_PASSWORD=mailarchive
```

The application will parse `DATABASE_URL` if provided, or fall back to individual parameters.
