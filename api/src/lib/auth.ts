import { FastifyRequest, FastifyReply } from "fastify";
import jwt from "jsonwebtoken";
import { db } from "../db.js";

const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret-change-in-production";

export type JwtPayload = { sub: string };

export function signToken(userId: string): string {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: "7d" });
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
    return decoded;
  } catch {
    return null;
  }
}

export async function requireAuth(
  request: FastifyRequest<{ Headers: { authorization?: string } }>,
  reply: FastifyReply
): Promise<string> {
  const auth = request.headers.authorization;
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) {
    // Debug: log whether header was received (helps trace proxy/UI issues)
    console.error("[auth] 401: authorization header present?", !!auth, "header keys:", Object.keys(request.headers).filter((k) => k.toLowerCase().includes("auth")).join(", ") || "none");
    reply.status(401).send({ error: "Missing or invalid Authorization header" });
    return "";
  }
  const payload = verifyToken(token);
  if (!payload?.sub) {
    reply.status(401).send({ error: "Invalid or expired token" });
    return "";
  }
  const result = await db.query("SELECT id FROM mailarchive_users WHERE id = $1", [payload.sub]);
  if (result.rows.length === 0) {
    reply.status(401).send({ error: "User not found" });
    return "";
  }
  return payload.sub;
}
