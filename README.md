# Mail Archive (CloudMail Archive)

Safely archive Outlook.com mail to your own S3-compatible storage and reclaim mailbox space. See [mailarchive_PRD.MD](mailarchive_PRD.MD) for product requirements.

## Phase 1 — Foundation

- **API**: Auth (register/login with JWT), CRUD for connections (placeholder) and rules. No UI.
- **Worker**: Single job type `run-archive`; stub that only logs. Uses BullMQ + Redis.

### Prerequisites

- Node.js 20+
- PostgreSQL
- Redis

### Setup

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Environment**

   Copy `.env.example` to `.env` and set:

   - `DATABASE_URL` — PostgreSQL connection string (e.g. `postgres://user:pass@localhost:5432/mailarchive`)
   - `JWT_SECRET` — Secret for signing auth tokens (use a strong value in production)
   - `REDIS_URL` — Redis URL for the worker (e.g. `redis://localhost:6379`)

3. **Database**

   From repo root:

   ```bash
   npm run db:migrate
   ```

   This runs migrations in `api/migrations/` (must be run from workspace so `api` is current dir for the migrate script; if you `cd api` you can run `npm run db:migrate` there).

4. **Run the API**

   ```bash
   npm run dev:api
   ```

   API listens on port 3000 (or `PORT`). Endpoints:

   - `POST /api/auth/register` — body: `{ "email", "password" }`
   - `POST /api/auth/login` — body: `{ "email", "password" }`
   - `GET/POST /api/connections` — require `Authorization: Bearer <token>`
   - `GET/POST/PATCH/DELETE /api/rules` — require `Authorization: Bearer <token>`
   - `GET /api/health` — health check

5. **Run the worker**

   In another terminal:

   ```bash
   npm run dev:worker
   ```

   To enqueue a test job (worker must be running):

   ```bash
   npm run enqueue-test -w worker
   ```

### Project layout

- `api/` — Fastify API, auth, connections & rules CRUD, migrations
- `worker/` — BullMQ worker, `run-archive` job (stub)
- `mailarchive_PRD.MD` — Product requirements

### Database table prefix

All tables use the `mailarchive_` prefix so the app can share a database with other applications: `mailarchive_users`, `mailarchive_connections`, `mailarchive_rules`.

### Docker (optional, for local Postgres + Redis)

```bash
docker compose up -d
```

Then set in `.env`:

- `DATABASE_URL=postgres://mailarchive:mailarchive@localhost:5432/mailarchive`
- `REDIS_URL=redis://localhost:6379`

### Phase 1 test

With API and worker running (and Postgres + Redis available):

```bash
chmod +x scripts/test-phase1.sh
./scripts/test-phase1.sh
```

Then in another terminal (with worker running): `npm run enqueue-test -w worker` to enqueue one stub job.

### Documentation

- [API Documentation](docs/API.md) - Endpoint reference
- [Database Schema](docs/DATABASE.md) - Table structure and migrations
- [Environment Variables](docs/ENVIRONMENT.md) - Configuration guide
- [Architecture](docs/ARCHITECTURE.md) - System design overview
- [XAMPP / Apache](docs/XAMPP.md) - Serving the web UI behind Apache and forwarding the Authorization header
- [Troubleshooting](docs/TROUBLESHOOTING.md) - Known issues and fixes so far
- [Risks: Max per run](docs/RISKS-MAX-PER-RUN.md) - Risks of increasing max messages per archive run (e.g. to 5000)

**Web UI rebuild:** When serving the app via Apache (e.g. `http://mailarchive.local`), the browser loads files from `web/dist/`. After any change to `web/src/`, run `npm run build -w web` so the built output is updated; then refresh the page to see changes.

### Phase 2 — Microsoft OAuth + Graph

- **Microsoft OAuth**: Connect Outlook.com accounts via Azure AD
- **Graph API**: List folders, get messages (MIME format)
- **Token Management**: Store encrypted tokens, automatic refresh

**Setup:**
1. Create Azure AD app registration (see [Microsoft Setup Guide](docs/MICROSOFT_SETUP.md))
2. Add Microsoft OAuth env vars to `.env`:
   - `MICROSOFT_CLIENT_ID`
   - `MICROSOFT_CLIENT_SECRET`
   - `MICROSOFT_TENANT_ID` (or use `common`)
   - `MICROSOFT_REDIRECT_URI`
   - `ENCRYPTION_KEY`
3. Install dependencies: `npm install`
4. Use endpoints:
   - `GET /api/microsoft/connect` - Start OAuth flow
   - `GET /api/microsoft/callback` - OAuth callback
   - `GET /api/microsoft/folders` - List mail folders
   - `GET /api/microsoft/status` - Check connection status

### Next phases

- Phase 3: S3 connection and upload
- Phase 4: Archive engine and safety modes
- Phase 5: Scheduling and UI

### Next feature (planned)

- **Archive email browser (Google Drive)** — Browse archived emails on Google Drive by folder (e.g. Inbox → year → month) and download `.eml` files. See [docs/NEXT-FEATURE-ARCHIVE-BROWSER.md](docs/NEXT-FEATURE-ARCHIVE-BROWSER.md) for the plan.
