import { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { db } from "../db.js";
import { requireAuth } from "../lib/auth.js";
import { encrypt } from "../lib/encryption.js";
import { getUserS3Config, uploadEml, buildObjectKey, type S3Config } from "../lib/s3.js";
import {
  getOneDriveForUser,
  updateOneDriveBasePath,
  normalizeOneDriveBasePath,
} from "../lib/onedrive.js";

type S3Body = {
  endpoint?: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  basePath?: string;
};

type S3PatchBody = {
  basePath?: string;
};

type OneDrivePatchBody = {
  basePath?: string;
};

export async function storageRoutes(app: FastifyInstance) {
  app.addHook("preHandler", async (request, reply) => {
    const userId = await requireAuth(request as never, reply);
    if (!userId) return;
    (request as { userId?: string }).userId = userId;
  });

  app.get("/s3", async (request, reply) => {
    const userId = (request as { userId?: string }).userId;
    if (!userId) return;

    const config = await getUserS3Config(userId);
    if (!config) {
      return reply.send({ configured: false });
    }

    return reply.send({
      configured: true,
      region: config.region,
      bucket: config.bucket,
      basePath: config.basePath ?? "",
      hasCredentials: !!config.accessKeyId && !!config.secretAccessKey,
    });
  });

  app.delete("/s3", async (request, reply) => {
    const userId = (request as { userId?: string }).userId;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });
    const result = await db.query(
      "DELETE FROM mailarchive_connections WHERE user_id = $1 AND provider = $2 RETURNING id",
      [userId, "s3"]
    );
    if (result.rowCount === 0) {
      return reply.status(404).send({ error: "S3 storage not configured" });
    }
    return reply.send({ ok: true });
  });

  app.post<{ Body: S3Body }>("/s3", async (request, reply) => {
    const userId = (request as { userId?: string }).userId;
    if (!userId) return;
    const body = request.body;

    if (!body || !body.region || !body.accessKeyId || !body.secretAccessKey || !body.bucket) {
      return reply.status(400).send({ error: "region, accessKeyId, secretAccessKey and bucket are required" });
    }

    const config = {
      endpoint: body.endpoint,
      region: body.region,
      accessKeyId: body.accessKeyId,
      secretAccessKey: body.secretAccessKey,
      bucket: body.bucket,
      basePath: body.basePath ?? "",
    };

    const encrypted = encrypt(JSON.stringify(config));
    const id = nanoid(22);

    await db.query(
      "INSERT INTO mailarchive_connections (id, user_id, provider, config_encrypted) VALUES ($1, $2, $3, $4)",
      [id, userId, "s3", encrypted]
    );

    return reply.status(201).send({
      id,
      provider: "s3",
      bucket: config.bucket,
      region: config.region,
      basePath: config.basePath,
    });
  });

  app.patch<{ Body: S3PatchBody }>("/s3", async (request, reply) => {
    const userId = (request as { userId?: string }).userId;
    if (!userId) return;
    const config = await getUserS3Config(userId);
    if (!config) {
      return reply.status(404).send({ error: "S3 storage not configured" });
    }
    if (request.body?.basePath === undefined) {
      return reply.status(400).send({ error: "basePath is required" });
    }
    const updated: S3Config = {
      ...config,
      basePath: String(request.body.basePath).trim(),
    };
    const encrypted = encrypt(JSON.stringify(updated));
    await db.query(
      "UPDATE mailarchive_connections SET config_encrypted = $1 WHERE user_id = $2 AND provider = $3",
      [encrypted, userId, "s3"]
    );
    return reply.send({
      configured: true,
      region: updated.region,
      bucket: updated.bucket,
      basePath: updated.basePath ?? "",
    });
  });

  app.get("/onedrive", async (request, reply) => {
    const userId = (request as { userId?: string }).userId;
    if (!userId) return;
    const oneDrive = await getOneDriveForUser(userId);
    if (!oneDrive) {
      return reply.send({ configured: false });
    }
    return reply.send({
      configured: true,
      basePath: oneDrive.basePath,
      note: "Uses your Microsoft account",
    });
  });

  app.patch<{ Body: OneDrivePatchBody }>("/onedrive", async (request, reply) => {
    const userId = (request as { userId?: string }).userId;
    if (!userId) return;
    if (request.body?.basePath === undefined) {
      return reply.status(400).send({ error: "basePath is required" });
    }
    try {
      normalizeOneDriveBasePath(request.body.basePath);
    } catch (err: unknown) {
      const e = err as { message?: string };
      return reply.status(400).send({ error: e.message || "Invalid basePath" });
    }
    const basePath = await updateOneDriveBasePath(userId, request.body.basePath);
    if (basePath === null) {
      return reply.status(404).send({ error: "Microsoft account not connected" });
    }
    return reply.send({ configured: true, basePath });
  });

  app.post("/s3/test", async (request, reply) => {
    const userId = (request as { userId?: string }).userId;
    if (!userId) return;

    const config = await getUserS3Config(userId);
    if (!config) {
      return reply.status(404).send({ error: "S3 storage not configured" });
    }

    try {
      const now = new Date();
      const key = buildObjectKey({
        userId,
        folderName: "test",
        receivedAt: now,
        subjectHash: "storage-test",
        basePath: config.basePath,
      });
      const body = `mailarchive storage test at ${now.toISOString()}\n`;
      const result = await uploadEml(config, key, body);
      return reply.send({ ok: true, bucket: result.bucket, key: result.key });
    } catch (err: unknown) {
      const e = err as { name?: string; message?: string };
      app.log.error(e);
      return reply
        .status(500)
        .send({ error: e.message || "Failed to upload test object", errorType: e.name || "Error" });
    }
  });
}
