import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { prisma } from "../lib/db.js";
import { confirmLoginCode, createLoginCode, signWebSession, takeLoginCode } from "../lib/webAuth.js";
import { botUsername } from "../bot/index.js";

/** Вход на сайт через бота (см. lib/webAuth.ts). Эти адреса доступны без авторизации. */
export async function webAuthRoutes(app: FastifyInstance) {
  app.post("/start", async (_req, reply) => {
    const bot = botUsername();
    if (!bot || !config.botToken) return reply.status(503).send({ error: "Вход на сайт временно недоступен" });
    const code = createLoginCode();
    return { code, url: `https://t.me/${bot}?start=login_${code}`, expiresIn: 600 };
  });

  app.get("/status", async (req) => {
    const code = String((req.query as Record<string, unknown>).code ?? "");
    const r = takeLoginCode(code);
    if (r.status !== "confirmed") return { status: r.status };
    return { status: "confirmed", token: signWebSession(r.userId, config.botToken) };
  });

  // Локальная разработка без Telegram: подтвердить код за пользователя с указанным Telegram ID
  if (config.devAuth) {
    app.post("/dev-confirm", async (req) => {
      const b = (req.body ?? {}) as { code?: string; telegramId?: number };
      const user = await prisma.user.upsert({
        where: { telegramId: BigInt(Number(b.telegramId)) },
        create: { telegramId: BigInt(Number(b.telegramId)), firstName: "Dev" },
        update: {},
      });
      return { ok: confirmLoginCode(String(b.code ?? ""), user.id) };
    });
  }
}
