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
  signLinkToken,
  signWebSession,
  takeLoginCode,
  tooManyAttempts,
  verifyLinkToken,
} from "../lib/webAuth.js";
import { mailEnabled, sendMail } from "../lib/mail.js";
import { sendTo } from "../bot/index.js";
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

  /**
   * Забыли пароль: ссылка на почту (и в Telegram, если он подключён).
   * Ответ всегда одинаковый, чтобы по нему нельзя было узнать, чья почта зарегистрирована.
   */
  app.post("/forgot", async (req, reply) => {
    const email = normalizeEmail(((req.body ?? {}) as { email?: string }).email);
    if (!email) return reply.status(400).send({ error: "Проверьте почту: похоже, в ней ошибка" });
    if (tooManyAttempts(`forgot:${req.ip}`, 10) || tooManyAttempts(`forgot:${email}`, 3)) {
      return reply.status(429).send({ error: "Ссылку уже отправили. Новую можно запросить через 15 минут" });
    }
    const user = await prisma.user.findUnique({ where: { email } });
    if (user) {
      const token = signLinkToken("reset", user.id, config.sessionSecret, user.passwordHash ?? "", 3600);
      const url = `${config.webAppUrl}?reset=${encodeURIComponent(token)}`;
      const text = "Вы запросили новый пароль для входа на сайт.\nСсылка действует 1 час. Если это были не вы, просто ничего не делайте.";
      const viaMail = await sendMail({ to: email, subject: "Новый пароль для Челленджей", text, button: { text: "Задать новый пароль", url } });
      const viaTg = user.telegramId !== null && (await sendTo(user.telegramId, `${text}\n\n${url}`));
      if (!viaMail && !viaTg) console.warn(`Сброс пароля для ${email}: почта не настроена и Telegram не подключён`);
    }
    return { ok: true, mail: mailEnabled() };
  });

  /** Новый пароль по ссылке из письма; сразу входим */
  app.post("/reset", async (req, reply) => {
    const b = (req.body ?? {}) as { token?: string; password?: string };
    const password = String(b.password ?? "");
    if (password.length < 6) return reply.status(400).send({ error: "Пароль: не короче 6 символов" });
    const id = await verifyLinkToken(String(b.token ?? ""), "reset", config.sessionSecret, async (uid) => {
      const u = await prisma.user.findUnique({ where: { id: uid }, select: { passwordHash: true } });
      return u ? (u.passwordHash ?? "") : null;
    });
    if (!id) return reply.status(400).send({ error: "Ссылка устарела или уже использована. Запросите новую" });
    await prisma.user.update({ where: { id }, data: { passwordHash: hashPassword(password) } });
    return { token: signWebSession(id, config.sessionSecret) };
  });

  /** «Не присылать напоминания на почту» — ссылка из письма */
  app.get("/unsubscribe", async (req, reply) => {
    const token = String((req.query as Record<string, unknown>).token ?? "");
    const id = await verifyLinkToken(token, "unsub", config.sessionSecret, async (uid) =>
      (await prisma.user.findUnique({ where: { id: uid }, select: { id: true } })) ? "" : null,
    );
    if (id) await prisma.user.update({ where: { id }, data: { emailReminders: false } });
    const msg = id
      ? "Готово: напоминания на почту больше не придут. Включить их снова можно в профиле на сайте."
      : "Ссылка устарела. Отключить напоминания можно в профиле на сайте.";
    return reply
      .type("text/html; charset=utf-8")
      .send(
        `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:system-ui,sans-serif;background:#eef1f6;display:grid;place-items:center;min-height:90vh;margin:0;padding:16px"><div style="background:#fff;border-radius:24px;padding:24px;max-width:420px;line-height:1.5">${msg}<p><a href="${config.webAppUrl}">Открыть приложение</a></p></div></body>`,
      );
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
