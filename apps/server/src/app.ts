import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { miniappRoutes } from "./routes/miniapp.js";
import { adminRoutes } from "./routes/admin.js";
import { webhookRoutes } from "./routes/webhooks.js";

const here = path.dirname(fileURLToPath(import.meta.url));

export async function buildApp() {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" }, bodyLimit: 1024 * 1024 });
  await app.register(cors, { origin: true });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

  fs.mkdirSync(config.uploadsDir, { recursive: true });
  await app.register(fastifyStatic, { root: path.resolve(config.uploadsDir), prefix: "/uploads/", decorateReply: false });

  // Собранные фронтенды (npm run build): Mini App на /app, админка на /admin
  for (const [prefix, dir] of [
    ["/app/", "../../miniapp/dist"],
    ["/admin/", "../../admin/dist"],
  ] as const) {
    const root = path.resolve(here, dir);
    if (fs.existsSync(root)) {
      await app.register(fastifyStatic, { root, prefix, decorateReply: false });
    }
  }

  app.get("/health", async () => ({ ok: true }));
  await app.register(miniappRoutes, { prefix: "/api" });
  await app.register(adminRoutes, { prefix: "/admin/api" });
  await app.register(webhookRoutes, { prefix: "/webhooks" });
  return app;
}
