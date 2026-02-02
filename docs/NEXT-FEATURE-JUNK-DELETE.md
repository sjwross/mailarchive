# Plan: Delete Suspected Porn Emails from Junk Folder

**Status:** Implemented (move to Deleted Items; manual + scheduled via `/api/jobs/run-junk-delete`)

## Goal

- A feature **separate from archive** that deletes messages suspected to be porn from the **Junk folder only**.
- User can run it manually and optionally on a schedule.
- No archiving; messages are **deleted** from the mailbox (or moved to Deleted Items for safety, then user can empty).

## Scope and safety

- **Target folder:** Junk only. Use Microsoft Graph to resolve the Junk folder (e.g. `wellKnownName: 'junkemail'` or match `displayName` "Junk Email" / "Junk").
- **Action:** Delete (or optionally “move to Deleted Items” first for a safety net).
- **No archive:** This flow does not touch S3/Google Drive or archive rules.
- **Per-user:** Uses existing Microsoft connection; same multi-user model as archive (each user’s Junk, their rules).

## Detection approach (“suspected porn”)

Options, from simplest to more involved:

| Approach | Pros | Cons |
|----------|------|------|
| **A. Keyword / pattern rules** | No external deps, fast, auditable | False positives/negatives; user or app maintains lists |
| **B. User-defined rules** | Flexible (sender, subject, body patterns) | User must define; may be coarse |
| **C. Content moderation API** | Stronger signal | Cost, latency, privacy, dependency |
| **D. ML classifier** | Can be tuned | Data, training, ops |

**Recommended for v1:** **A + B**

- **Built-in:** Small set of configurable keywords/phrases (subject + optional body) and/or sender/domain patterns, stored in app config or DB (e.g. “junk delete” rule).
- **User-defined (optional):** Allow user to add their own “delete if subject/sender matches” patterns so the feature stays clearly “suspected” and under their control.
- **No body by default:** Prefer subject + sender only for speed and privacy; add body scanning only if needed, with clear limits (e.g. first N KB, or only when user enables “aggressive” mode).

Later: add optional integration to a content-moderation API or simple ML if you want to refine “suspected” with less reliance on keywords.

## Data model

- **Option 1 – Separate table (recommended):** e.g. `mailarchive_junk_delete_rules`  
  - `id`, `user_id`, `name`, `enabled`, `schedule` (manual | daily | weekly), `last_run_at`, `max_per_run`, `config` (JSON: keyword list, sender/domain patterns, “move to Deleted” vs “hard delete”), `created_at`.  
  - Keeps “archive” and “junk delete” clearly separate; easy to add more detection options later.

- **Option 2 – Reuse rules table with type:**  
  - Add `type: 'archive' | 'junk_delete'` (and maybe target folder) to existing rules.  
  - Fewer tables but mixes two different intents (archive vs delete-from-Junk) in one model.

Recommendation: **Option 1** so archive semantics (folders, age, storage) stay untouched and junk-delete can evolve (keywords, patterns, schedules) independently.

## API design (high level)

- **Resolve Junk folder:**  
  - `GET /api/microsoft/folders` (or reuse existing folder list) and pick folder where `wellKnownName === 'junkemail'` or `displayName` matches “Junk Email” / “Junk”.

- **Junk-delete rules CRUD:**  
  - `GET /api/junk-delete/rules` – list user’s junk-delete rules.  
  - `POST /api/junk-delete/rules` – create (name, schedule, max_per_run, config: keywords, patterns, delete vs move).  
  - `PATCH /api/junk-delete/rules/:id` – update.  
  - `DELETE /api/junk-delete/rules/:id` – delete.

- **Run once (manual):**  
  - `POST /api/junk-delete/rules/:id/run` – for one rule: resolve Junk folder, list messages (paginated), apply detection, delete (or move) matched messages; return counts (scanned, deleted, errors).

- **Run scheduled (cron):**  
  - `POST /api/jobs/run-junk-delete` (or extend existing jobs route) – same as run-scheduled but for junk-delete rules: for each user’s enabled junk-delete rules that are due, run the same “list Junk → detect → delete” logic.  
  - Secure with same `CRON_SECRET` (or a dedicated secret) so only cron can call it.

- **Detection config (in rule config JSON):**  
  - `keywords`: string[] (subject/body phrases, case-insensitive).  
  - `senderPatterns`: string[] (e.g. domains or “*@spam.com”).  
  - `action`: `'delete' | 'moveToDeleted'`.  
  - Optional: `scanBody`: boolean, `maxMessages`: number per run.

## Microsoft Graph usage

- **List folders:** Reuse `listFolders`; find Junk by `wellKnownName` or `displayName` (Graph may expose `junkemail`).
- **List messages in Junk:** Reuse `listMessages(client, userId, junkFolderId, top, receivedBefore)` with pagination as needed.
- **Delete:** Reuse `deleteMessage(client, userId, messageId)`.
- **Optional “move to Deleted”:** Use `moveMessage(client, userId, messageId, deletedItemsFolderId)` then optionally delete; or only move and let user empty Deleted Items.

No new Graph permissions if you already have mail read + delete (or move); confirm scopes include delete (and move if used).

## UI (separate from archive)

- **Section:** e.g. “Junk folder cleanup” or “Delete suspected spam from Junk,” below or beside Archive Rules.
- **List:** Show user’s junk-delete rules (name, schedule, last run, config summary).
- **Create/Edit rule:**  
  - Name, schedule (manual / daily / weekly), max per run.  
  - Detection: keyword list (textarea or tags), optional sender/domain patterns.  
  - Action: “Delete permanently” vs “Move to Deleted Items.”
- **Actions:** “Run now” (calls `POST .../run`), Edit, Delete.
- **Run result:** Show “Scanned: N, Deleted: M, Errors: K” (and which messages were deleted if you want a simple log).

Keep this section and all copy clearly separate from “Archive” so users don’t confuse “archive to storage” with “delete from Junk.”

## Implementation order

1. **Backend – Junk folder + delete flow**  
   - Resolve Junk folder ID from Graph (folder list / wellKnownName).  
   - Implement “list Junk messages → apply keyword/sender detection → delete (or move)” in a new module (e.g. `api/src/lib/junk-delete.ts`), reusing existing Graph client and `deleteMessage` / `moveMessage`.

2. **Backend – Detection**  
   - Implement keyword matching (subject, optionally body) and sender/domain pattern matching (allowlist/blocklist style).  
   - Keep detection logic in one place so you can later swap or add API/ML.

3. **Backend – Data model and API**  
   - Migration: create `mailarchive_junk_delete_rules`.  
   - CRUD and `POST .../run` for junk-delete rules; optional `POST /api/jobs/run-junk-delete` for cron.

4. **Cron (optional)**  
   - If you want scheduled runs: add cron job that calls `run-junk-delete` (same pattern as run-scheduled), and document in README.

5. **Frontend**  
   - New “Junk folder cleanup” section: list rules, add/edit form (name, schedule, keywords, patterns, action), “Run now,” display last run result.

## Risks and mitigations

- **False positives:** Deleting non-porn. Mitigate: start with “Move to Deleted Items” only; optional “dry run” (report what would be deleted, no delete); conservative default keyword list; let user tune or disable.
- **Rate limits:** Graph throttling. Mitigate: cap `max_per_run` (e.g. 50–200), small delay between deletes if needed.
- **Legal / policy:** Ensure deletion is intentional and documented. Mitigate: clear UI copy (“Permanently delete from Junk”), optional confirmation for “delete” vs “move.”

## References

- Existing: `api/src/lib/microsoft-graph.ts` (`listFolders`, `listMessages`, `deleteMessage`, `moveMessage`).
- Archive flow: `api/src/lib/archive.ts`, `api/src/routes/rules.ts`, `api/src/routes/jobs.ts`.
- Microsoft Graph Mail: [Mail API](https://learn.microsoft.com/en-us/graph/api/resources/mail-api-overview), [well-known folder names](https://learn.microsoft.com/en-us/graph/api/resources/mailfolder#mailfolder-resource-type) (e.g. `junkemail`).
