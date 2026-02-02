import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { db } from "../db.js";
import { requireAuth } from "../lib/auth.js";
import { runJunkDeleteOnce, type JunkDeleteConfig } from "../lib/junk-delete.js";

const SCHEDULES = ["manual", "daily", "weekly"] as const;
const MAX_PER_RUN_DEFAULT = 50;
const MAX_PER_RUN_LIMIT = 500;

export async function junkDeleteRoutes(app: FastifyInstance) {
  app.addHook("preHandler", async (request, reply) => {
    const userId = await requireAuth(request as never, reply);
    if (!userId) return;
    (request as { userId?: string }).userId = userId;
  });

  app.get("/rules", async (request, reply) => {
    const userId = (request as { userId?: string }).userId;
    if (!userId) return;
    const result = await db.query(
      "SELECT id, name, enabled, schedule, last_run_at, max_per_run, config, created_at FROM mailarchive_junk_delete_rules WHERE user_id = $1 ORDER BY created_at DESC",
      [userId]
    );
    return reply.send({ rules: result.rows });
  });

  app.post<{
    Body: {
      name: string;
      schedule?: string;
      max_per_run?: number;
      keywords?: string[];
      senderPatterns?: string[];
    };
  }>("/rules", async (request, reply) => {
    const userId = (request as { userId?: string }).userId;
    if (!userId) return;
    const body = request.body ?? {};
    const name = body.name;
    if (!name || typeof name !== "string" || !name.trim()) {
      return reply.status(400).send({ error: "name is required" });
    }
    const schedule = SCHEDULES.includes((body.schedule as (typeof SCHEDULES)[number]) ?? "manual")
      ? (body.schedule as (typeof SCHEDULES)[number])
      : "manual";
    const rawMax = body.max_per_run != null ? Number(body.max_per_run) : MAX_PER_RUN_DEFAULT;
    const max_per_run = Math.min(
      MAX_PER_RUN_LIMIT,
      Math.max(1, rawMax || MAX_PER_RUN_DEFAULT)
    );
    const keywords = Array.isArray(body.keywords) ? body.keywords.filter((x): x is string => typeof x === "string") : [];
    const senderPatterns = Array.isArray(body.senderPatterns)
      ? body.senderPatterns.filter((x): x is string => typeof x === "string")
      : [];
    const config: JunkDeleteConfig = { keywords, senderPatterns };
    const id = nanoid(22);
    await db.query(
      "INSERT INTO mailarchive_junk_delete_rules (id, user_id, name, enabled, schedule, max_per_run, config) VALUES ($1, $2, $3, true, $4, $5, $6)",
      [id, userId, name.trim(), schedule, max_per_run, JSON.stringify(config)]
    );
    const row = (
      await db.query(
        "SELECT id, name, enabled, schedule, last_run_at, max_per_run, config, created_at FROM mailarchive_junk_delete_rules WHERE id = $1",
        [id]
      )
    ).rows[0];
    return reply.status(201).send(row);
  });

  app.get<{ Params: { id: string } }>("/rules/:id", async (request, reply) => {
    const userId = (request as { userId?: string }).userId;
    if (!userId) return;
    const result = await db.query(
      "SELECT id, name, enabled, schedule, last_run_at, max_per_run, config, created_at FROM mailarchive_junk_delete_rules WHERE id = $1 AND user_id = $2",
      [request.params.id, userId]
    );
    if (result.rows.length === 0) {
      return reply.status(404).send({ error: "Rule not found" });
    }
    return reply.send(result.rows[0]);
  });

  app.patch<{
    Params: { id: string };
    Body: {
      name?: string;
      enabled?: boolean;
      schedule?: string;
      max_per_run?: number;
      keywords?: string[];
      senderPatterns?: string[];
    };
  }>("/rules/:id", async (request, reply) => {
    const userId = (request as { userId?: string }).userId;
    if (!userId) return;
    const id = request.params.id;
    const body = request.body ?? {};
    const existing = await db.query(
      "SELECT id, name, enabled, schedule, max_per_run, config FROM mailarchive_junk_delete_rules WHERE id = $1 AND user_id = $2",
      [id, userId]
    );
    if (existing.rows.length === 0) {
      return reply.status(404).send({ error: "Rule not found" });
    }
    const row = existing.rows[0];
    const name = body.name != null ? (typeof body.name === "string" ? body.name.trim() : row.name) : row.name;
    const enabled = body.enabled !== undefined ? Boolean(body.enabled) : row.enabled;
    const schedule = SCHEDULES.includes((body.schedule as (typeof SCHEDULES)[number]) ?? row.schedule)
      ? (body.schedule as (typeof SCHEDULES)[number])
      : row.schedule;
    const rawMax = body.max_per_run != null ? Number(body.max_per_run) : row.max_per_run;
    const max_per_run = Math.min(MAX_PER_RUN_LIMIT, Math.max(1, rawMax || MAX_PER_RUN_DEFAULT));
    const config = row.config as JunkDeleteConfig;
    const keywords = Array.isArray(body.keywords) ? body.keywords.filter((x): x is string => typeof x === "string") : config.keywords;
    const senderPatterns = Array.isArray(body.senderPatterns)
      ? body.senderPatterns.filter((x): x is string => typeof x === "string")
      : config.senderPatterns;
    const newConfig: JunkDeleteConfig = { keywords, senderPatterns };
    await db.query(
      "UPDATE mailarchive_junk_delete_rules SET name = $1, enabled = $2, schedule = $3, max_per_run = $4, config = $5 WHERE id = $6 AND user_id = $7",
      [name, enabled, schedule, max_per_run, JSON.stringify(newConfig), id, userId]
    );
    const updated = (
      await db.query(
        "SELECT id, name, enabled, schedule, last_run_at, max_per_run, config, created_at FROM mailarchive_junk_delete_rules WHERE id = $1",
        [id]
      )
    ).rows[0];
    return reply.send(updated);
  });

  app.delete<{ Params: { id: string } }>("/rules/:id", async (request, reply) => {
    const userId = (request as { userId?: string }).userId;
    if (!userId) return;
    const result = await db.query(
      "DELETE FROM mailarchive_junk_delete_rules WHERE id = $1 AND user_id = $2 RETURNING id",
      [request.params.id, userId]
    );
    if (result.rows.length === 0) {
      return reply.status(404).send({ error: "Rule not found" });
    }
    return reply.send({ ok: true });
  });

  app.post<{ Params: { id: string } }>("/rules/:id/run", async (request, reply) => {
    const userId = (request as { userId?: string }).userId;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });
    const ruleId = request.params.id;
    try {
      const summary = await runJunkDeleteOnce(userId, ruleId);
      request.log.info({ ruleId, summary }, "junk-delete run completed");
      return reply.send({ ok: true, summary });
    } catch (err: unknown) {
      const e = err as { message?: string };
      request.log.warn({ err: e, ruleId }, "junk-delete run failed");
      return reply.status(400).send({ ok: false, error: e.message || "Run failed" });
    }
  });
}
