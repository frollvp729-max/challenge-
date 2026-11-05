import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { prisma } from "../lib/db.js";
import {
  checkPassword,
  confirmLoginCode,
  createLoginCode,
  hashPassword,
  normalizeEmail,
  resetAttempts,
  signWebSession,
  takeLoginCode,
  tooManyAttempts,
} from "../lib/webAuth.js";
import { botUsername } from "../bot/index.js";

/** Вход на сайт через бота (см. lib/webAuth.ts). Эти адреса доступны без авторизации. */
export async function webAuthRoutes(app: FastifyInstance) {
  /** Регистрация на сайте без Telegram */
  app.post("/register", async (req, reply) => {
    const b = (req.body ?? {}) as { email?: string; password?: string; name?: string };
    const email = normalizeEmail(b.email);
    const password = String(b.password ?? "");
    const name = String(b.name ?? "").trim().slice(0, 32);
    if (tooManyAttempts(`ip:${req.ip}`, 30)) return reply.status(429).send({ error: "Слишком много попыток, подождите 15 минут" });
    if (!name) return reply.status(400).send({ error: "Укажите имя" });
    if (!email) return reply.status(400).send({ error: "Проверьте почту: похоже, в ней ошибка" });
    if (password.length < 6) return reply.status(400).send({ error: "Пароль: не короче 6 символов" });
    if (await prisma.user.findUnique({ where: { email } })) {
      return reply.status(409).send({ error: "Эта почта уже зарегистрирована. Нажмите «Вход»" });
    }
    const user = await prisma.user.create({
      data: { email, passwordHash: hashPassword(password), firstName: name, displayName: name },
    });
    return { token: signWebSession(user.id, config.sessionSecret) };
  });

  app.post("/login", async (req, reply) => {
    const b = (req.body ?? {}) as { email?: string; password?: string };
    const email = normalizeEmail(b.email);
    if (tooManyAttempts(`ip:${req.ip}`, 30) || (email && tooManyAttempts(`email:${email}`))) {
      return reply.status(429).send({ error: "Слишком много попыток, подождите 15 минут" });
    }
    const user = email ? await prisma.user.findUnique({ where: { email } }) : null;
    if (!user || !checkPassword(String(b.password ?? ""), user.passwordHash)) {
      return reply.status(401).send({ error: "Неверная почта или пароль" });
    }
    resetAttempts(`email:${email}`);
    return { token: signWebSession(user.id, config.sessionSecret) };
  });

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
    return { status: "confirmed", token: signWebSession(r.userId, config.sessionSecret) };
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
