import type { FastifyInstance } from "fastify";
import { db } from "../db.js";
import { requireAuth } from "../lib/auth.js";

const VALID_STORAGE = ["s3", "gdrive", "onedrive"] as const;

export async function settingsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", async (request, reply) => {
    const userId = await requireAuth(request as never, reply);
    if (!userId) return;
    (request as { userId?: string }).userId = userId;
  });

  app.get("/archive-storage", async (request, reply) => {
    const userId = (request as { userId?: string }).userId;
    if (!userId) return;
    const result = await db.query<{ preferred_archive_storage: string | null }>(
      "SELECT preferred_archive_storage FROM mailarchive_users WHERE id = $1",
      [userId]
    );
    const preferred =
      result.rows[0]?.preferred_archive_storage && VALID_STORAGE.includes(result.rows[0].preferred_archive_storage as (typeof VALID_STORAGE)[number])
        ? (result.rows[0].preferred_archive_storage as (typeof VALID_STORAGE)[number])
        : null;
    return reply.send({ preferred });
  });

  app.patch<{
    Body: { preferred?: string | null };
  }>("/archive-storage", async (request, reply) => {
    const userId = (request as { userId?: string }).userId;
    if (!userId) return;
    const preferred = request.body?.preferred;
    const value =
      preferred === null || preferred === undefined || preferred === ""
        ? null
        : VALID_STORAGE.includes(preferred as (typeof VALID_STORAGE)[number])
          ? (preferred as (typeof VALID_STORAGE)[number])
          : null;
    await db.query(
      "UPDATE mailarchive_users SET preferred_archive_storage = $1 WHERE id = $2",
      [value, userId]
    );
    return reply.send({ preferred: value });
  });
}
