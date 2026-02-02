import { FastifyInstance } from "fastify";
import { db } from "../db.js";
import { runArchiveOnce } from "../lib/archive.js";

const WEEKLY_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_PER_RUN_DEFAULT = 50;
const MAX_PER_RUN_LIMIT = 500;

export async function jobsRoutes(app: FastifyInstance) {
  app.post("/run-scheduled", async (request, reply) => {
    const cronSecret = process.env.CRON_SECRET;
    const headerSecret = request.headers["x-cron-secret"];

    if (!cronSecret || headerSecret !== cronSecret) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const rulesResult = await db.query<{
      id: string;
      user_id: string;
      schedule: string;
      last_run_at: Date | null;
      max_per_run: number | null;
    }>(`
      SELECT id, user_id, schedule, last_run_at, max_per_run
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
      // Weekly: throttle to once per 7 days. Daily: run every time cron fires (cron is once per day at 3 AM).
      if (rule.schedule === "weekly") {
        const now = Date.now();
        const last = rule.last_run_at ? rule.last_run_at.getTime() : 0;
        if (last && now - last < WEEKLY_MS) {
          summaries.push({
            ruleId: rule.id,
            userId: rule.user_id,
            schedule: rule.schedule,
            ran: false,
          });
          continue;
        }
      }

      const raw = rule.max_per_run ?? MAX_PER_RUN_DEFAULT;
      const maxMessages = Math.min(
        MAX_PER_RUN_LIMIT,
        Math.max(1, Number(raw) || MAX_PER_RUN_DEFAULT)
      );

      try {
        await runArchiveOnce(rule.user_id, rule.id, maxMessages);
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

