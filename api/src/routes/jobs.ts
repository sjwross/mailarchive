import { FastifyInstance } from "fastify";
import { db } from "../db.js";
import { runArchiveOnce } from "../lib/archive.js";

const DAILY_MS = 24 * 60 * 60 * 1000;
const WEEKLY_MS = 7 * DAILY_MS;

export async function jobsRoutes(app: FastifyInstance) {
  app.post("/run-scheduled", async (request, reply) => {
    const cronSecret = process.env.CRON_SECRET;
    const headerSecret = request.headers["x-cron-secret"];

    if (!cronSecret || headerSecret !== cronSecret) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const now = Date.now();

    const rulesResult = await db.query<{
      id: string;
      user_id: string;
      schedule: string;
      last_run_at: Date | null;
    }>(`
      SELECT id, user_id, schedule, last_run_at
      FROM mailarchive_rules
      WHERE schedule != 'manual'
    `);

    const summaries: {
      ruleId: string;
      userId: string;
      schedule: string;
      ran: boolean;
      error?: string;
    }[] = [];

    for (const rule of rulesResult.rows) {
      const last = rule.last_run_at ? rule.last_run_at.getTime() : 0;
      const threshold = rule.schedule === "daily" ? DAILY_MS : WEEKLY_MS;

      if (last && now - last < threshold) {
        summaries.push({
          ruleId: rule.id,
          userId: rule.user_id,
          schedule: rule.schedule,
          ran: false,
        });
        continue;
      }

      try {
        await runArchiveOnce(rule.user_id, rule.id, 50);
        await db.query("UPDATE mailarchive_rules SET last_run_at = NOW() WHERE id = $1", [rule.id]);
        summaries.push({
          ruleId: rule.id,
          userId: rule.user_id,
          schedule: rule.schedule,
          ran: true,
        });
      } catch (err: unknown) {
        const e = err as { message?: string };
        summaries.push({
          ruleId: rule.id,
          userId: rule.user_id,
          schedule: rule.schedule,
          ran: false,
          error: e.message || "Failed to run scheduled archive",
        });
      }
    }

    return reply.send({ ok: true, summaries });
  });
}

