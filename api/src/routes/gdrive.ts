import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { db } from "../db.js";
import { requireAuth } from "../lib/auth.js";
import { encrypt, decrypt } from "../lib/encryption.js";
import { getDriveAuthUrl, exchangeCodeForTokens, getDriveForUser, getOAuthClient } from "../lib/google-drive.js";
import { google } from "googleapis";

export async function gdriveRoutes(app: FastifyInstance) {
  // Require auth for all routes EXCEPT callback (OAuth callbacks don't have auth headers)
  app.addHook("preHandler", async (request, reply) => {
    // Skip auth for callback - it authenticates via state parameter
    if ((request as { url?: string }).url?.includes("/callback")) {
      return;
    }
    const userId = await requireAuth(request as never, reply);
    if (!userId) return;
    (request as { userId?: string }).userId = userId;
  });

  app.get("/connect", async (request, reply) => {
    const userId = (request as { userId?: string }).userId;
    if (!userId) return;

    try {
      const state = nanoid(32);
      const authUrl = getDriveAuthUrl(state);
      const id = nanoid(22);

      const payload = encrypt(JSON.stringify({ state, userId }));

      await db.query(
        "INSERT INTO mailarchive_connections (id, user_id, provider, config_encrypted) VALUES ($1, $2, $3, $4)",
        [id, userId, "gdrive_oauth_state", payload]
      );

      return reply.send({ authUrl, state });
    } catch (err: unknown) {
      const e = err as { message?: string };
      app.log.error(e);
      return reply.status(500).send({ error: e.message || "Google Drive not configured" });
    }
  });

  app.get<{
    Querystring: { code?: string; state?: string; error?: string };
  }>("/callback", async (request, reply) => {
    const { code, state, error } = request.query;

    if (error) {
      return reply.status(400).send({ error: `OAuth error: ${error}` });
    }

    if (!code || !state) {
      return reply.status(400).send({ error: "Missing code or state" });
    }

    try {
      // Look up state to get userId (OAuth callbacks authenticate via state, not JWT)
      const stateRows = await db.query(
        "SELECT config_encrypted FROM mailarchive_connections WHERE provider = $1 ORDER BY created_at DESC LIMIT 1",
        ["gdrive_oauth_state"]
      );

      if (stateRows.rows.length === 0) {
        return reply.status(400).send({ error: "Invalid state" });
      }

      const saved = JSON.parse(decrypt(stateRows.rows[0].config_encrypted));
      if (saved.state !== state) {
        return reply.status(400).send({ error: "Invalid state" });
      }

      const userId = saved.userId;
      if (!userId) {
        return reply.status(400).send({ error: "Invalid state: missing user ID" });
      }

      const tokens = await exchangeCodeForTokens(code);

      // Get user email from Google OAuth2 API
      const oauth2 = getOAuthClient();
      oauth2.setCredentials({
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        expiry_date: tokens.expiryDate,
      });
      const oauth2Client = google.oauth2({ version: "v2", auth: oauth2 });
      const userInfo = await oauth2Client.userinfo.get();
      const email = userInfo.data.email || null;

      const configWithEmail = { ...tokens, email };
      const encrypted = encrypt(JSON.stringify(configWithEmail));
      const connectionId = nanoid(22);

      await db.query(
        "INSERT INTO mailarchive_connections (id, user_id, provider, config_encrypted) VALUES ($1, $2, $3, $4)",
        [connectionId, userId, "gdrive", encrypted]
      );

      await db.query("DELETE FROM mailarchive_connections WHERE user_id = $1 AND provider = $2", [
        userId,
        "gdrive_oauth_state",
      ]);

      return reply.send({
        success: true,
        connectionId,
        email,
      });
    } catch (err: unknown) {
      const e = err as { message?: string };
      app.log.error(e);
      return reply.status(500).send({ error: e.message || "Failed to complete Google OAuth flow" });
    }
  });

  app.get("/status", async (request, reply) => {
    const userId = (request as { userId?: string }).userId;
    if (!userId) return;

    const conn = await getDriveForUser(userId);
    if (!conn) {
      return reply.send({ connected: false });
    }

    return reply.send({
      connected: true,
      email: conn.config.email || null,
    });
  });
}

