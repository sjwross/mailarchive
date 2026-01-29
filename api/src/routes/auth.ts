import { FastifyInstance } from "fastify";
import bcrypt from "bcrypt";
import { nanoid } from "nanoid";
import { db } from "../db.js";
import { signToken } from "../lib/auth.js";

export async function authRoutes(app: FastifyInstance) {
  app.post<{
    Body: { email: string; password: string };
  }>("/register", async (request, reply) => {
    const { email, password } = request.body ?? {};
    if (!email || typeof email !== "string" || !password || typeof password !== "string") {
      return reply.status(400).send({ error: "email and password required" });
    }
    const id = nanoid(22);
    const password_hash = await bcrypt.hash(password, 10);
    try {
      await db.query(
        "INSERT INTO mailarchive_users (id, email, password_hash) VALUES ($1, $2, $3)",
        [id, email.toLowerCase().trim(), password_hash]
      );
    } catch (err: unknown) {
      const e = err as { code?: string };
      if (e.code === "23505") {
        return reply.status(409).send({ error: "Email already registered" });
      }
      throw err;
    }
    const token = signToken(id);
    return reply.status(201).send({ token, user: { id, email: email.toLowerCase().trim() } });
  });

  app.post<{
    Body: { email: string; password: string };
  }>("/login", async (request, reply) => {
    const { email, password } = request.body ?? {};
    if (!email || typeof email !== "string" || !password || typeof password !== "string") {
      return reply.status(400).send({ error: "email and password required" });
    }
    const result = await db.query(
      "SELECT id, email, password_hash FROM mailarchive_users WHERE email = $1",
      [email.toLowerCase().trim()]
    );
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return reply.status(401).send({ error: "Invalid email or password" });
    }
    const token = signToken(user.id);
    return reply.send({ token, user: { id: user.id, email: user.email } });
  });
}
