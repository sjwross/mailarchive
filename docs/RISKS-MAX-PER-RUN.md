# Risks of Increasing Max Per Run to 5000

Raising the **max per run** limit (e.g. from **500** to **5000**) increases how many messages a single archive run can process. Below are the main risks and possible mitigations.

---

## 1. External API rate limits

- **Microsoft Graph** — Each message requires at least one `getMessageMime` call (plus paginated list calls). Thousands of calls in a short window can hit Graph’s per-app/per-user throttling (e.g. 429), causing the run to slow or fail partway.
- **Google Drive** — Each message is one `files.create` (upload). Drive has per-user quotas (e.g. requests per 100 seconds). 5000 uploads in one run can trigger rate limits or quota errors.

**Mitigation:** Add retries with backoff on 429, and/or keep a lower per-run cap (e.g. 1000–2000) so runs complete within typical quotas.

---

## 2. HTTP / proxy timeouts

- **Run now** is a single synchronous `POST /api/rules/:id/run-now` from the browser. With 5000 messages, the run can take many minutes (e.g. 10–30+).
- Browsers, reverse proxies (e.g. Apache), and load balancers often have timeouts (e.g. 60–120 s). The request can be cut off before the run finishes, so the user sees a timeout even though the server may still be working.

**Mitigation:** Run large jobs asynchronously (e.g. worker + job queue), and have the UI poll for status or use “Run in background” so the HTTP request returns quickly.

---

## 3. User experience

- The UI may look stuck for a long time with no feedback.
- If the request times out, the user doesn’t know how many messages were archived or whether to run again.

**Mitigation:** Prefer background runs with progress/status (e.g. “Running…”, “Archived 1200 / 5000”) or at least a clear “This may take several minutes” message and a way to check result later.

---

## 4. Partial failure and retries

- If the run fails partway (e.g. after 2000 messages) due to rate limit or timeout, some messages are already archived and some are not.
- Retrying “Run now” might reprocess already-archived messages (depending on move/delete rules and how idempotency is handled), or leave the user unsure what was archived.

**Mitigation:** Design for idempotency (e.g. skip or overwrite by message id); consider checkpointing or “resume from last run” for very large runs; show “archived X, failed Y” clearly.

---

## 5. Resource usage

- **Memory** — 5000 message metadata entries and any in-memory buffering are usually fine, but very large MIME bodies or many concurrent operations could increase memory use.
- **Connections** — Long-running run holds DB and possibly HTTP connections; under load, many such runs could exhaust pools.
- **CPU** — Less of a concern than I/O and API limits, but long serial work can tie up one worker.

**Mitigation:** Keep processing sequential or bounded concurrency; avoid loading 5000 full MIME bodies into memory at once; ensure connection pools and timeouts are sized for long-running requests if you keep sync run-now.

---

## 6. Scheduled / worker runs

- If the **worker** runs the same rule with `max_per_run = 5000`, the same rate-limit and duration issues apply. Worker jobs often have a maximum execution time (e.g. 30 minutes); the job may be killed before 5000 messages are done.

**Mitigation:** Either lower max per run for scheduled jobs, or split work into multiple smaller jobs (e.g. several runs of 500–1000) so each job finishes within worker timeout and rate limits.

---

## Summary

| Risk area           | Effect of 5000 per run                          |
|---------------------|--------------------------------------------------|
| API rate limits     | Higher chance of 429 / quota errors              |
| HTTP timeouts       | Browser/proxy may cut off the request            |
| UX                  | Long wait, possible “hang” or confusing timeout  |
| Partial failure     | Unclear state on retry, possible double work     |
| Resources / worker  | Long-running job may hit timeout or pool limits  |

**Practical approach:** Keep a **hard cap** (e.g. 500–1000) unless you add **async/background runs**, **retries with backoff**, and **clear progress/result reporting**. If you do raise to 5000, do it together with background execution and rate-limit handling; otherwise, a lower cap (e.g. 1000–2000) is safer.
