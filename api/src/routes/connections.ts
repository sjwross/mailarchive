import { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { db } from "../db.js";
import { requireAuth } from "../lib/auth.js";

export async function connectionsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", async (request, reply) => {
    const userId = await requireAuth(request as never, reply);
    if (!userId) return;
    (request as { userId?: string }).userId = userId;
  });

  app.get("/", async (request, reply) => {
    const userId = (request as { userId?: string }).userId;
    if (!userId) return;
    const result = await db.query(
      "SELECT id, provider, created_at FROM mailarchive_connections WHERE user_id = $1 ORDER BY created_at DESC",
      [userId]
    );
    return reply.send({ connections: result.rows });
  });

  app.post<{
    Body: { provider: string };
  }>("/", async (request, reply) => {
    const userId = (request as { userId?: string }).userId;
    if (!userId) return;
    const provider = request.body?.provider ?? "s3";
    const id = nanoid(22);
    await db.query(
      "INSERT INTO mailarchive_connections (id, user_id, provider) VALUES ($1, $2, $3)",
      [id, userId, provider]
    );
    return reply.status(201).send({ id, user_id: userId, provider });
  });

  app.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const userId = (request as { userId?: string }).userId;
    if (!userId) return;
    const result = await db.query(
      "SELECT id, provider, created_at FROM mailarchive_connections WHERE id = $1 AND user_id = $2",
      [request.params.id, userId]
    );
    if (result.rows.length === 0) return reply.status(404).send({ error: "Connection not found" });
    return reply.send(result.rows[0]);
  });

  app.delete<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const userId = (request as { userId?: string }).userId;
    if (!userId) return;
    const result = await db.query(
      "DELETE FROM mailarchive_connections WHERE id = $1 AND user_id = $2 RETURNING id",
      [request.params.id, userId]
    );
    if (result.rowCount === 0) return reply.status(404).send({ error: "Connection not found" });
    return reply.status(204).send();
  });
}
