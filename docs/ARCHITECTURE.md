# Architecture Overview

## System Components

### API Server (`api/`)

Fastify-based REST API providing:
- User authentication (register/login)
- Connection management (cloud storage providers)
- Rule management (archive rules)
- Microsoft OAuth integration (Phase 2+)
- Graph API proxy endpoints (Phase 2+)

**Tech Stack:**
- Fastify (web framework)
- PostgreSQL (via `pg`)
- JWT (authentication)
- TypeScript

### Worker (`worker/`)

Background job processor using BullMQ:
- Processes `run-archive` jobs
- Fetches emails from Microsoft Graph (Phase 4)
- Uploads to cloud storage (Phase 4)
- Performs cleanup actions (Phase 4)

**Tech Stack:**
- BullMQ (job queue)
- Redis (queue backend)
- TypeScript

## Data Flow

### Phase 1 (Current)

```
User → API → PostgreSQL
User → API → Worker → Redis → Job Processing
```

### Phase 4 (Future)

```
User → API → PostgreSQL
API → Worker → Redis
Worker → Microsoft Graph → Fetch Emails
Worker → S3/Storage → Upload .eml
Worker → Microsoft Graph → Delete/Move
Worker → PostgreSQL → Update Status
```

## Database

Single PostgreSQL database with prefixed tables (`mailarchive_*`) to allow sharing with other applications.

**Connection:** Uses connection string parsing with fallback to individual parameters (see Database.md).

## Job Queue

BullMQ with Redis backend:
- Queue name: `archive`
- Job type: `run-archive`
- Job data: `{ userId, ruleId }`

## Authentication

- JWT tokens issued on register/login
- 7-day expiration
- Required for all endpoints except `/api/health` and `/api/auth/*`

## Security

- Passwords hashed with bcrypt (10 rounds)
- JWT tokens signed with secret
- Connection credentials encrypted at rest (Phase 3+)
- User-scoped data access (all queries filtered by `user_id`)

## Deployment

### Local Development

1. Start Postgres and Redis (Docker Compose or local)
2. Set environment variables
3. Run migrations
4. Start API: `npm run dev:api`
5. Start Worker: `npm run dev:worker`

### Production (hosting.com)

- API runs as web process
- Worker runs as background process or cron-triggered
- PostgreSQL and Redis provided by hosting.com
- See PRD for hosting.com-specific considerations
