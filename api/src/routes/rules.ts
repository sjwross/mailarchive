import { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { db } from "../db.js";
import { requireAuth } from "../lib/auth.js";
import { runArchiveOnce } from "../lib/archive.js";

const SAFETY_MODES = ["archive_only", "archive_move", "archive_delete"] as const;
const SCHEDULES = ["manual", "daily", "weekly"] as const;
const MAX_PER_RUN_DEFAULT = 50;
const MAX_PER_RUN_LIMIT = 500;

export async function rulesRoutes(app: FastifyInstance) {
  app.addHook("preHandler", async (request, reply) => {
    const userId = await requireAuth(request as never, reply);
    if (!userId) return;
    (request as { userId?: string }).userId = userId;
  });

  app.get("/", async (request, reply) => {
    const userId = (request as { userId?: string }).userId;
    if (!userId) return;
    const result = await db.query(
      "SELECT id, name, age_threshold_days, folder_ids, safety_mode, schedule, max_per_run, created_at, last_run_at FROM mailarchive_rules WHERE user_id = $1 ORDER BY created_at DESC",
      [userId]
    );
    return reply.send({ rules: result.rows });
  });

  app.post<{ Params: { id: string } }>("/:id/run-now", async (request, reply) => {
    const userId = (request as { userId?: string }).userId;
    if (!userId) return;

    const ruleId = request.params.id;
    const ruleRow = await db.query(
      "SELECT max_per_run FROM mailarchive_rules WHERE id = $1 AND user_id = $2",
      [ruleId, userId]
    );
    if (ruleRow.rows.length === 0) {
      return reply.status(404).send({ ok: false, error: "Rule not found" });
    }
    const raw = ruleRow.rows[0].max_per_run ?? MAX_PER_RUN_DEFAULT;
    const maxMessages = Math.min(MAX_PER_RUN_LIMIT, Math.max(1, Number(raw) || MAX_PER_RUN_DEFAULT));

    try {
      const summary = await runArchiveOnce(userId, ruleId, maxMessages);
      return reply.send({
        ok: true,
        summary,
      });
    } catch (err: unknown) {
      const e = err as { message?: string };
      return reply.status(400).send({ ok: false, error: e.message || "Failed to run archive" });
    }
  });

  app.post<{
    Body: {
      name: string;
      age_threshold_days: number;
      folder_ids?: string[];
      safety_mode?: string;
      schedule?: string;
      max_per_run?: number;
    };
  }>("/", async (request, reply) => {
    const userId = (request as { userId?: string }).userId;
    if (!userId) return;
    const body = request.body ?? {};
    const name = body.name;
    const age_threshold_days = body.age_threshold_days;
    if (!name || typeof name !== "string" || typeof age_threshold_days !== "number") {
      return reply.status(400).send({ error: "name and age_threshold_days required" });
    }
    const safety_mode = SAFETY_MODES.includes(body.safety_mode as (typeof SAFETY_MODES)[number])
      ? body.safety_mode
      : "archive_only";
    const schedule = SCHEDULES.includes(body.schedule as (typeof SCHEDULES)[number])
      ? body.schedule
      : "manual";
    const folder_ids = Array.isArray(body.folder_ids) ? body.folder_ids : [];
    const rawMax = body.max_per_run != null ? Number(body.max_per_run) : MAX_PER_RUN_DEFAULT;
    const max_per_run = Math.min(MAX_PER_RUN_LIMIT, Math.max(1, rawMax || MAX_PER_RUN_DEFAULT));
    const id = nanoid(22);
    await db.query(
      "INSERT INTO mailarchive_rules (id, user_id, name, age_threshold_days, folder_ids, safety_mode, schedule, max_per_run) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
      [id, userId, name, age_threshold_days, JSON.stringify(folder_ids), safety_mode, schedule, max_per_run]
    );
    const row = (
      await db.query(
        "SELECT id, name, age_threshold_days, folder_ids, safety_mode, schedule, max_per_run, created_at FROM mailarchive_rules WHERE id = $1",
        [id]
      )
    ).rows[0];
    return reply.status(201).send(row);
  });

  app.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const userId = (request as { userId?: string }).userId;
    if (!userId) return;
    const result = await db.query(
      "SELECT id, name, age_threshold_days, folder_ids, safety_mode, schedule, max_per_run, created_at FROM mailarchive_rules WHERE id = $1 AND user_id = $2",
      [request.params.id, userId]
    );
    if (result.rows.length === 0) return reply.status(404).send({ error: "Rule not found" });
    return reply.send(result.rows[0]);
  });

  app.patch<{
    Params: { id: string };
    Body: {
      name?: string;
      age_threshold_days?: number;
      folder_ids?: string[];
      safety_mode?: string;
      schedule?: string;
      max_per_run?: number;
    };
  }>("/:id", async (request, reply) => {
    const userId = (request as { userId?: string }).userId;
    if (!userId) return;
    const body = request.body ?? {};
    const result = await db.query(
      "SELECT id, name, age_threshold_days, folder_ids, safety_mode, schedule, max_per_run FROM mailarchive_rules WHERE id = $1 AND user_id = $2",
      [request.params.id, userId]
    );
    if (result.rows.length === 0) return reply.status(404).send({ error: "Rule not found" });
    const row = result.rows[0];
    const name = body.name !== undefined ? body.name : row.name;
    const age_threshold_days = body.age_threshold_days !== undefined ? body.age_threshold_days : row.age_threshold_days;
    const folder_ids = body.folder_ids !== undefined ? body.folder_ids : row.folder_ids;
    const safety_mode = body.safety_mode && SAFETY_MODES.includes(body.safety_mode as (typeof SAFETY_MODES)[0])
      ? body.safety_mode
      : row.safety_mode;
    const schedule = body.schedule && SCHEDULES.includes(body.schedule as (typeof SCHEDULES)[0])
      ? body.schedule
      : row.schedule;
    const rawMax = body.max_per_run !== undefined ? Number(body.max_per_run) : row.max_per_run ?? MAX_PER_RUN_DEFAULT;
    const max_per_run = Math.min(MAX_PER_RUN_LIMIT, Math.max(1, rawMax || MAX_PER_RUN_DEFAULT));
    await db.query(
      "UPDATE mailarchive_rules SET name = $1, age_threshold_days = $2, folder_ids = $3, safety_mode = $4, schedule = $5, max_per_run = $6 WHERE id = $7 AND user_id = $8",
      [name, age_threshold_days, JSON.stringify(folder_ids), safety_mode, schedule, max_per_run, request.params.id, userId]
    );
    const updated = (
      await db.query(
        "SELECT id, name, age_threshold_days, folder_ids, safety_mode, schedule, max_per_run, created_at FROM mailarchive_rules WHERE id = $1",
        [request.params.id]
      )
    ).rows[0];
    return reply.send(updated);
  });

  app.delete<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const userId = (request as { userId?: string }).userId;
    if (!userId) return;
    const result = await db.query(
      "DELETE FROM mailarchive_rules WHERE id = $1 AND user_id = $2 RETURNING id",
      [request.params.id, userId]
    );
    if (result.rowCount === 0) return reply.status(404).send({ error: "Rule not found" });
    return reply.status(204).send();
  });
}
