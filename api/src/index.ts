import "./env.js";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { authRoutes } from "./routes/auth.js";
import { connectionsRoutes } from "./routes/connections.js";
import { rulesRoutes } from "./routes/rules.js";
import { microsoftRoutes } from "./routes/microsoft.js";
import { storageRoutes } from "./routes/storage.js";
import { jobsRoutes } from "./routes/jobs.js";
import { gdriveRoutes } from "./routes/gdrive.js";
import { db } from "./db.js";

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });
await app.register(authRoutes, { prefix: "/api/auth" });
await app.register(connectionsRoutes, { prefix: "/api/connections" });
await app.register(rulesRoutes, { prefix: "/api/rules" });
await app.register(microsoftRoutes, { prefix: "/api/microsoft" });
await app.register(storageRoutes, { prefix: "/api/storage" });
await app.register(jobsRoutes, { prefix: "/api/jobs" });
await app.register(gdriveRoutes, { prefix: "/api/gdrive" });

app.get("/api/health", async () => ({ ok: true }));

const start = async () => {
  try {
    await db.connect();
    const port = Number(process.env.PORT) || 3000;
    await app.listen({ port, host: "127.0.0.1" });
    app.log.info(`Server listening on http://127.0.0.1:${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
