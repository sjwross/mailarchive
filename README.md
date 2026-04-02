# Mail Archive

Archive Outlook.com mail to your own storage (S3-compatible buckets, Google Drive, or OneDrive) and manage archive rules from a web UI.

## Requirements

- **Node.js** 20+
- **PostgreSQL** (local or hosted; connection string in `.env`)
- **Redis** (for the optional background worker / BullMQ)

## Quick start

```bash
npm install
cp .env.example .env
# Edit .env: set DATABASE_URL, JWT_SECRET, REDIS_URL
npm run db:migrate
npm run dev:api
```

Check the API:

```bash
curl -s http://127.0.0.1:3000/api/health
```

Expect: `{"ok":true}`

Optional:

```bash
npm run dev:worker   # background archive worker (needs Redis)
npm run dev:web      # Vite dev UI (default http://localhost:5173)
```

Build the production web bundle:

```bash
npm run build -w web
```

Output is in `web/dist/`.

## Documentation

| Doc | Description |
|-----|-------------|
| [docs/API.md](docs/API.md) | HTTP API reference |
| [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md) | Environment variables |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System overview |
| [docs/DATABASE.md](docs/DATABASE.md) | Schema and migrations |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | Common failures and fixes |

For **PostgreSQL via Homebrew** (no Docker), see [docs/LOCAL-INSTALL.md](docs/LOCAL-INSTALL.md).

For **Apache / reverse proxy** (e.g. serving `web/dist` behind a vhost), see [docs/XAMPP.md](docs/XAMPP.md).

Optional **Docker** Postgres/Redis for local dev: `docker compose up -d` in the repo root (see `docker-compose.yml`).

## Private developer notes

If you maintain machine-specific setup (paths, recovery steps, local Apache), copy `DEV-LOCAL.example.md` to `DEV-LOCAL.md` in the repo root. That file is **gitignored** and will not be pushed.

## Product context

High-level requirements and roadmap: [mailarchive_PRD.MD](mailarchive_PRD.MD).
