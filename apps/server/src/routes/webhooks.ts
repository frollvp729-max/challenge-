import type { FastifyInstance } from "fastify";
import { webhookCallback } from "grammy";
import { config } from "../config.js";
import { verifyTributeSignature, type TributeEvent } from "../lib/tribute.js";
import { handleTributeEvent } from "../services/payments.js";
import { bot } from "../bot/index.js";

export async function webhookRoutes(app: FastifyInstance) {
  // Сырое тело нужно для проверки подписи
  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    (req as any).rawBody = body;
    try {
      done(null, body ? JSON.parse(body as string) : {});
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  app.post("/tribute", async (req, reply) => {
    const raw = (req as any).rawBody as string;
    const sig = req.headers["trbt-signature"] as string | undefined;
    if (!verifyTributeSignature(raw, sig, config.tributeApiKey)) {
      req.log.warn("Tribute webhook: неверная подпись");
      return reply.status(401).send({ error: "bad signature" });
    }
    const result = await handleTributeEvent(req.body as TributeEvent);
    req.log.info({ event: (req.body as TributeEvent).name, result }, "Tribute webhook");
    return { ok: true, result };
  });

  if (bot && config.botMode === "webhook") {
    app.post(`/telegram/${config.botWebhookSecret}`, webhookCallback(bot, "fastify", { secretToken: config.botWebhookSecret || undefined }));
  }
}
