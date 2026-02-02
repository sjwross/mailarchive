import { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { db } from "../db.js";
import { requireAuth } from "../lib/auth.js";
import { getAuthUrl, acquireTokenByCode, generateState } from "../lib/microsoft-auth.js";
import { createGraphClient, listFolders, getMe } from "../lib/microsoft-graph.js";
import { encrypt, decrypt } from "../lib/encryption.js";
import { getMicrosoftToken } from "../lib/microsoft-token.js";

export async function microsoftRoutes(app: FastifyInstance) {
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
      const state = generateState();
      const authUrl = await getAuthUrl(state);

      // Debug: log the auth URL to help troubleshoot redirect URI issues
      app.log.info(`[microsoft] Generated auth URL for user ${userId}, redirect URI: ${process.env.MICROSOFT_REDIRECT_URI}`);

      const id = nanoid(22);

      await db.query(
        "INSERT INTO mailarchive_connections (id, user_id, provider, config_encrypted) VALUES ($1, $2, $3, $4)",
        [id, userId, "microsoft_oauth_state", JSON.stringify({ state, userId })]
      );

      return reply.send({ authUrl, state });
    } catch (err: unknown) {
      const e = err as { message?: string };
      app.log.error({ err: e }, "Microsoft connect error");
      return reply.status(500).send({ error: e.message || "Failed to generate Microsoft auth URL" });
    }
  });

  app.get<{
    Querystring: { code?: string; state?: string; error?: string; error_description?: string };
  }>("/callback", async (request, reply) => {
    const { code, state, error, error_description } = request.query;

    if (error) {
      // Log full Microsoft error for debugging (invalid_request often has details in error_description)
      app.log.warn({ error, error_description, query: request.query }, "Microsoft OAuth callback error");
      const msg = error_description
        ? `OAuth error: ${error} — ${error_description}`
        : `OAuth error: ${error}`;
      return reply.status(400).send({ error: msg });
    }

    if (!code || !state) {
      return reply.status(400).send({ error: "Missing code or state" });
    }

    try {
      // Look up state to get userId (OAuth callbacks authenticate via state, not JWT)
      const stateRows = await db.query(
        "SELECT config_encrypted FROM mailarchive_connections WHERE provider = $1 ORDER BY created_at DESC LIMIT 1",
        ["microsoft_oauth_state"]
      );

      if (stateRows.rows.length === 0) {
        return reply.status(400).send({ error: "Invalid state" });
      }

      // Microsoft stores state as plain JSON (not encrypted like Google)
      const saved = JSON.parse(stateRows.rows[0].config_encrypted);
      if (saved.state !== state) {
        return reply.status(400).send({ error: "Invalid state" });
      }

      const userId = saved.userId;
      if (!userId) {
        return reply.status(400).send({ error: "Invalid state: missing user ID" });
      }

      const { result: tokenResponse, refreshToken } = await acquireTokenByCode(code);
      const graphClient = createGraphClient(tokenResponse.accessToken);
      const me = await getMe(graphClient);

      const tokenData = {
        accessToken: tokenResponse.accessToken,
        refreshToken: refreshToken || "",
        expiresAt: tokenResponse.expiresOn?.getTime() || Date.now() + 3600000,
        accountId: me.id,
        email: me.mail,
      };

      const encrypted = encrypt(JSON.stringify(tokenData));
      const connectionId = nanoid(22);

      await db.query(
        "INSERT INTO mailarchive_connections (id, user_id, provider, config_encrypted) VALUES ($1, $2, $3, $4)",
        [connectionId, userId, "microsoft", encrypted]
      );

      await db.query("DELETE FROM mailarchive_connections WHERE user_id = $1 AND provider = $2", [
        userId,
        "microsoft_oauth_state",
      ]);

      return reply.send({
        success: true,
        connectionId,
        email: me.mail,
      });
    } catch (err: unknown) {
      const e = err as { message?: string };
      app.log.error(e);
      return reply.status(500).send({ error: e.message || "Failed to complete OAuth flow" });
    }
  });

  app.get("/folders", async (request, reply) => {
    const userId = (request as { userId?: string }).userId;
    if (!userId) return;

    const tokenResult = await getMicrosoftToken(userId);
    if (!tokenResult) {
      return reply.status(404).send({ error: "Microsoft account not connected" });
    }

    try {
      const folders = await listFolders(tokenResult.client, tokenResult.tokenData.accountId);
      return reply.send({ folders });
    } catch (err: unknown) {
      const e = err as { message?: string };
      app.log.error(e);
      return reply.status(500).send({ error: e.message || "Failed to list folders" });
    }
  });

  app.delete("/disconnect", async (request, reply) => {
    const userId = (request as { userId?: string }).userId;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });
    const result = await db.query(
      "DELETE FROM mailarchive_connections WHERE user_id = $1 AND provider = $2 RETURNING id",
      [userId, "microsoft"]
    );
    if (result.rowCount === 0) {
      return reply.status(404).send({ error: "Microsoft account not connected" });
    }
    return reply.send({ ok: true });
  });

  app.get("/status", async (request, reply) => {
    const userId = (request as { userId?: string }).userId;
    if (!userId) return;

    const connection = await db.query(
      "SELECT id, config_encrypted, created_at FROM mailarchive_connections WHERE user_id = $1 AND provider = $2 ORDER BY created_at DESC LIMIT 1",
      [userId, "microsoft"]
    );

    if (connection.rows.length === 0) {
      return reply.send({ connected: false });
    }

    try {
      const tokenData = JSON.parse(decrypt(connection.rows[0].config_encrypted));
      return reply.send({
        connected: true,
        email: tokenData.email,
        expiresAt: tokenData.expiresAt,
        connectionId: connection.rows[0].id,
      });
    } catch {
      return reply.send({ connected: false, error: "Failed to decrypt connection" });
    }
  });
}
