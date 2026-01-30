# Local install (PostgreSQL + Redis via Homebrew)

Use this when you run Postgres and Redis locally instead of Docker.

## Prerequisites

- macOS with [Homebrew](https://brew.sh)
- Node.js 20+

## 1. Install PostgreSQL and Redis

```bash
brew install postgresql@16 redis
```

## 2. Start services

```bash
brew services start postgresql@16
brew services start redis
```

## 3. Create the mailarchive user and database (one-time)

Using the Postgres superuser (your macOS user):

```bash
/opt/homebrew/opt/postgresql@16/bin/psql postgres -c "CREATE USER mailarchive WITH PASSWORD 'mailarchive';"
/opt/homebrew/opt/postgresql@16/bin/psql postgres -c "CREATE DATABASE mailarchive OWNER mailarchive;"
```

If you get "role already exists" or "database already exists", that’s fine.

## 4. Configure .env

In the repo root, ensure `.env` has:

```env
DATABASE_URL=postgres://mailarchive:mailarchive@localhost:5432/mailarchive
REDIS_URL=redis://localhost:6379
```

Plus your existing `JWT_SECRET`, `ENCRYPTION_KEY`, and any OAuth vars.

## 5. Run migrations

```bash
npm run db:migrate
```

## 6. Start the app (no Docker)

**Option A — one command (API + worker + web):**

```bash
npm run dev:local
```

**Option B — separate terminals:**

```bash
npm run dev:api     # terminal 1
npm run dev:worker  # terminal 2
npm run dev:web     # terminal 3 (optional)
```

- API: http://localhost:3000  
- Web (Vite): http://localhost:5173  

## Useful commands

| Command | Description |
|--------|-------------|
| `brew services list` | See if Postgres and Redis are running |
| `brew services stop postgresql@16` | Stop Postgres |
| `brew services stop redis` | Stop Redis |
| `brew services restart postgresql@16` | Restart Postgres |

## PATH for PostgreSQL@16

Homebrew’s `postgresql@16` is keg-only. To use `psql` in your shell:

```bash
export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"
```

You can add that to `~/.zshrc` if you use the CLI often.
