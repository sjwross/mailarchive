# Local developer notes (private)

Copy this file to **`DEV-LOCAL.md`** in the same directory.  
`DEV-LOCAL.md` is listed in `.gitignore` so it is not committed.

Use it for:

- Homebrew Postgres paths, XAMPP vhost paths, and hostnames on your Mac
- Recovery steps when Postgres or the API fails after reboot
- OAuth redirect URLs you registered in Azure / Google for *your* dev URLs
- Cron wrapper location (`~/bin/...`) and `~/.mailarchive-cron.env` reminders

Keep secrets out of this file if you ever remove it from `.gitignore` by mistake; prefer referencing env var *names* only.

## Template

```markdown
# DEV-LOCAL (private)

## Environment
- Repo path:
- DATABASE_URL pattern (no password):
- UI URL:

## Postgres (Homebrew)
- Data directory:
- Start command:

## Recovery (if API says ECONNREFUSED :5432)
- (your steps)

## Apache / mailarchive vhost
- Config include:
- ServerName:

## Cron
- Crontab line:
- Log file:
```
