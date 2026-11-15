import type { InlineKeyboard } from "grammy";
import type { Challenge, User } from "@prisma/client";
import { config } from "../config.js";
import { prisma } from "../lib/db.js";
import { esc, introMessage, paidMessage } from "../bot/messages.js";
import { grantAccess, joinStartDate, primaryEnrollment } from "../services/enrollments.js";
import { cancelLoginCode, confirmLoginCode, createLoginCode, isLoginCodeOpen, linkTargetOf } from "../lib/webAuth.js";
import { botUsername } from "../bot/index.js";
import { AccountConflict, linkPlatform } from "../services/accounts.js";
import { humanDate } from "../lib/dates.js";
import { MaxError, maxApi, type MaxButton, type MaxMessageBody, type MaxUpdate, type MaxUser } from "./api.js";

/**
 * Бот в мессенджере Max. Делает то же, что бот Telegram:
 * знакомит с челленджем, открывает приложение, присылает задания и напоминания,
 * подтверждает вход на сайт и подключение Max к общему аккаунту.
 * Приложение в Max — тот же сайт /app/, открытый как мини-приложение.
 */

export const maxEnabled = () => Boolean(config.maxBotToken);

let botName = config.maxBotUsername;
/** Ник бота Max без @: из настроек, иначе то, что вернул Max при запуске */
export function maxBotUsername(): string {
  return botName;
}

/** Ссылка на бота Max с параметром /start */
export function maxStartLink(payload: string): string | null {
  const name = maxBotUsername();
  return name ? `https://max.ru/${name}?start=${encodeURIComponent(payload)}` : null;
}

/**
 * Параметры экрана приложения ↔ стартовый параметр мини-приложения Max.
 * { screen: "chat", enrollment: "12" } → "chat_e12"
 */
export function encodeStartApp(params: Record<string, string>): string {
  const parts: string[] = [];
  if (params.screen) parts.push(params.screen.replace(/[^a-z]/g, ""));
  if (params.enrollment) parts.push(`e${Number(params.enrollment)}`);
  return parts.join("_");
}

/** Ссылка, которая открывает мини-приложение в Max (на нужном экране) */
export function maxAppLink(params: Record<string, string> = {}): string {
  const name = maxBotUsername();
  const startapp = encodeStartApp(params);
  if (!name) return config.webAppUrl;
  return `https://max.ru/${name}?startapp${startapp ? `=${startapp}` : ""}`;
}

/** Клавиатура из сообщений Telegram (grammy) → кнопки Max */
export function toMaxButtons(kb?: InlineKeyboard): MaxButton[][] | undefined {
  if (!kb) return undefined;
  const rows: MaxButton[][] = [];
  for (const row of kb.inline_keyboard) {
    const out: MaxButton[] = [];
    for (const b of row) {
      if ("web_app" in b && b.web_app) {
        const params = Object.fromEntries(new URL(b.web_app.url).searchParams);
        out.push({ type: "link", text: b.text, url: maxAppLink(params) });
      } else if ("url" in b && b.url) {
        out.push({ type: "link", text: b.text, url: b.url });
      } else if ("callback_data" in b && b.callback_data) {
        out.push({ type: "callback", text: b.text, payload: b.callback_data });
      }
    }
    if (out.length) rows.push(out);
  }
  return rows.length ? rows : undefined;
}

function body(text: string, buttons?: MaxButton[][]): MaxMessageBody {
  return {
    text,
    format: "html",
    attachments: buttons ? [{ type: "inline_keyboard", payload: { buttons } }] : [],
  };
}

const openAppButtons = (text = "ОТКРЫТЬ ПРИЛОЖЕНИЕ", params: Record<string, string> = {}): MaxButton[][] => [
  [{ type: "link", text, url: maxAppLink(params) }],
];

/** Сообщение участнику в Max; false — не дошло (бот остановлен, Max выключен) */
export async function sendToMax(maxId: bigint | number | null, text: string, keyboard?: InlineKeyboard | MaxButton[][]): Promise<boolean> {
  if (maxId === null) return false;
  if (!maxEnabled()) return false;
  const buttons = Array.isArray(keyboard) ? keyboard : toMaxButtons(keyboard);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await maxApi.sendToUser(maxId, body(text, buttons));
      return true;
    } catch (err) {
      if (err instanceof MaxError && err.status === 429) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      if (err instanceof MaxError && (err.status === 403 || err.status === 404)) {
        await prisma.user.updateMany({ where: { maxId: BigInt(maxId) }, data: { maxBlocked: true } });
        return false;
      }
      console.error("Max: сообщение не отправлено", err);
      return false;
    }
  }
  return false;
}

function names(u: MaxUser) {
  return {
    firstName: u.first_name || u.name || undefined,
    lastName: u.last_name || undefined,
    username: u.username || undefined,
  };
}

/** Найти или создать участника по аккаунту Max */
export async function upsertMaxUser(u: MaxUser, platformSeen = false): Promise<User> {
  const n = names(u);
  return prisma.user.upsert({
    where: { maxId: BigInt(u.user_id) },
    create: { maxId: BigInt(u.user_id), ...n, lastPlatform: "max" },
    update: { maxBlocked: false, ...(platformSeen ? { lastPlatform: "max" } : {}) },
  });
}

async function defaultChallenge(slug?: string, organizer = false): Promise<Challenge | null> {
  if (slug) {
    const bySlug = await prisma.challenge.findFirst({ where: { slug, status: organizer ? { in: ["ACTIVE", "DRAFT"] } : "ACTIVE" } });
    if (bySlug) return bySlug;
  }
  return prisma.challenge.findFirst({ where: { status: "ACTIVE" }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] });
}

const reply = (userId: number, text: string, buttons?: MaxButton[][]) => sendToMax(userId, text, buttons);

async function handleStart(from: MaxUser, payload: string) {
  const user = await upsertMaxUser(from);
  // login_<код>: вход на сайт или подключение Max к аккаунту
  if (payload.startsWith("login_")) {
    const code = payload.slice(6);
    if (!isLoginCodeOpen(code)) {
      await reply(from.user_id, "Ссылка устарела. Нажмите кнопку на сайте ещё раз.");
      return;
    }
    const host = config.publicUrl.replace(/^https?:\/\//, "");
    const linking = linkTargetOf(code) !== undefined;
    await reply(
      from.user_id,
      linking
        ? `Подключить этот аккаунт Max к вашему аккаунту челленджей?\n\nПосле этого челленджи, баллы и оплата будут общими: занимайтесь хоть здесь, хоть в Telegram, хоть на сайте <b>${esc(host)}</b>.`
        : `Вход на сайт <b>${esc(host)}</b> под вашим аккаунтом Max.\n\nНажмите «Войти», если это вы открыли сайт. Если нет, нажмите «Отмена».`,
      [
        [
          { type: "callback", text: linking ? "Подключить" : "Войти", payload: `weblogin:${code}` },
          { type: "callback", text: "Отмена", payload: `webcancel:${code}` },
        ],
      ],
    );
    return;
  }
  const slug = payload.startsWith("c_") ? payload.slice(2) : undefined;
  const enrollment = await primaryEnrollment(user.id);
  if (enrollment && !slug) {
    await reply(from.user_id, `Вы участвуете в челлендже «${esc(enrollment.stream.challenge.title)}».`, openAppButtons());
    return;
  }
  const ch = await defaultChallenge(slug, user.isOrganizer);
  if (!ch) {
    await reply(from.user_id, "Скоро здесь появится новый челлендж. Мы напишем, когда откроется запись.", openAppButtons());
    return;
  }
  const m = introMessage(ch);
  await reply(from.user_id, m.text, [
    [{ type: "callback", text: "УЧАСТВОВАТЬ", payload: `join:${ch.id}` }],
    [{ type: "link", text: "ВСЕ ЧЕЛЛЕНДЖИ", url: maxAppLink({ screen: "catalog" }) }],
  ]);
}

/**
 * В Max своей оплаты нет: платят в Telegram через Tribute.
 * Если Telegram ещё не подключён, ссылка сначала подключает его к этому аккаунту
 * (бот в Telegram спросит подтверждение и сразу покажет оплату), поэтому оплата попадёт в общий аккаунт.
 */
export function telegramPayLink(user: Pick<User, "id" | "telegramId">, ch: Pick<Challenge, "slug">): string | null {
  const tg = botUsername();
  if (!tg) return null;
  if (user.telegramId !== null) return `https://t.me/${tg}?start=c_${ch.slug}`;
  return `https://t.me/${tg}?start=login_${createLoginCode(user.id, ch.slug)}`;
}

function maxPriceMessage(ch: Challenge, startDate: string, user: User) {
  const lines = [`<b>${esc(ch.title)}</b>`, "", `Стоимость участия: <b>${ch.priceRub} ₽</b>${ch.paymentMode === "SUBSCRIPTION" ? " в месяц" : ""}`];
  if (ch.startDate && startDate === ch.startDate) lines.push("", `Старт: ${humanDate(startDate)}`);
  else lines.push("", "Старт на следующий день после оплаты. У каждого свои 30 дней.");
  const link = ch.tributeLink ? telegramPayLink(user, ch) : null;
  if (!link) {
    lines.push("", "Оплата скоро откроется.");
    return { text: lines.join("\n"), buttons: undefined };
  }
  lines.push(
    "",
    "Оплата проходит в Telegram через Tribute.",
    user.telegramId !== null
      ? "Нажмите кнопку: в Telegram откроется бот с оплатой."
      : "Нажмите кнопку: бот в Telegram попросит подключить этот аккаунт (кнопка «Подключить») и сразу покажет оплату. Ссылка действует 10 минут.",
    "После оплаты челлендж откроется и здесь, в Max.",
  );
  return { text: lines.join("\n"), buttons: [[{ type: "link", text: `ОПЛАТИТЬ ${ch.priceRub} ₽ В TELEGRAM`, url: link }]] as MaxButton[][] };
}

async function handleCallback(cb: NonNullable<MaxUpdate["callback"]>) {
  const data = cb.payload ?? "";
  const from = cb.user;
  const answer = (notification?: string, message?: MaxMessageBody) =>
    maxApi.answerCallback(cb.callback_id, { notification, message }).catch(() => undefined);

  let m: RegExpMatchArray | null;
  if ((m = data.match(/^join:(\d+)$/))) {
    await answer();
    const user = await upsertMaxUser(from);
    const ch = await prisma.challenge.findUnique({ where: { id: Number(m[1]) } });
    if (ch && user.isOrganizer && ch.status !== "ARCHIVED") {
      const res = await grantAccess(user.id, ch.id, "organizer", new Date(), { startToday: true });
      await reply(
        from.user_id,
        `Вы организатор: доступ к «${esc(ch.title)}» открыт бесплатно, ваш день 1 сегодня.`,
        openAppButtons("ОТКРЫТЬ ЧЕЛЛЕНДЖ", { enrollment: String(res.enrollment.id) }),
      );
      return;
    }
    if (!ch || ch.status !== "ACTIVE") {
      await reply(from.user_id, "Запись на этот челлендж закрыта.");
      return;
    }
    if (ch.paymentMode === "FREE") {
      const res = await grantAccess(user.id, ch.id, "free");
      const pm = paidMessage(res.startDate, user.timezone);
      await reply(from.user_id, pm.text.replace("Оплата получена.", "Готово!"), openAppButtons());
      return;
    }
    const pm = maxPriceMessage(ch, joinStartDate(ch, user.timezone), user);
    await reply(from.user_id, pm.text, pm.buttons);
    return;
  }
  if ((m = data.match(/^weblogin:(.+)$/))) {
    const code = m[1];
    const target = linkTargetOf(code);
    if (target !== undefined && isLoginCodeOpen(code)) {
      try {
        const user = await linkPlatform(target, "max", { id: from.user_id, username: from.username, first_name: from.first_name, last_name: from.last_name });
        confirmLoginCode(code, user.id);
        await answer("Готово", body("Готово! Max подключён. Теперь челленджи открываются и здесь, и там, где вы занимались раньше."));
        await reply(from.user_id, "Открыть приложение:", openAppButtons());
      } catch (err) {
        if (!(err instanceof AccountConflict)) throw err;
        cancelLoginCode(code);
        await answer(undefined, body(esc(err.message)));
      }
      return;
    }
    const user = await upsertMaxUser(from);
    const ok = confirmLoginCode(code, user.id);
    await answer(
      ok ? "Готово" : "Ссылка устарела",
      body(ok ? "Готово! Вернитесь на сайт: вход выполнен." : "Ссылка для входа устарела. Нажмите кнопку на сайте ещё раз."),
    );
    return;
  }
  if ((m = data.match(/^webcancel:(.+)$/))) {
    cancelLoginCode(m[1]);
    await answer("Вход отменён", body("Вход отменён."));
    return;
  }
  await answer();
}

async function handleText(from: MaxUser, text: string) {
  const t = text.trim();
  if (t.startsWith("/start")) return handleStart(from, t.slice(6).trim());
  await upsertMaxUser(from);
  if (t.startsWith("/help")) {
    await reply(
      from.user_id,
      "Каждое утро я присылаю задание дня, вечером напоминаю, если отчёта ещё нет.\n\n/app — открыть приложение\n/start — начать",
      openAppButtons(),
    );
    return;
  }
  await reply(from.user_id, "Задания, отчёты, рейтинг и чат участников открываются в приложении:", openAppButtons());
}

export async function handleMaxUpdate(u: MaxUpdate) {
  if (u.update_type === "bot_started" && u.user) return handleStart(u.user, String(u.payload ?? "").trim());
  if (u.update_type === "message_callback" && u.callback) return handleCallback(u.callback);
  if (u.update_type === "message_created" && u.message?.sender && !u.message.sender.is_bot) {
    // только личные сообщения боту
    if (u.message.recipient?.user_id === null && u.message.recipient?.chat_id !== null && u.message.recipient?.chat_id !== undefined) {
      const dialog = u.message.recipient.chat_id === u.chat_id;
      if (!dialog) return;
    }
    return handleText(u.message.sender, u.message.body?.text ?? "");
  }
}

let stopped = false;

/** Запуск бота Max: долгий опрос (long polling), без вебхуков и открытых портов */
export async function startMaxBot() {
  if (!maxEnabled()) {
    console.log("MAX_BOT_TOKEN не задан: бот Max выключен.");
    return;
  }
  try {
    const me = await maxApi.me();
    if (!botName && me.username) botName = me.username;
    console.log(`Бот Max ${botName ? `@${botName}` : me.first_name ?? me.name ?? ""} запущен (long polling)`);
  } catch (err) {
    if (err instanceof MaxError && err.status === 401) {
      console.error("Бот Max не запущен: Max не принял MAX_BOT_TOKEN. Проверьте токен в apps/server/.env и перезапустите: docker compose up -d");
      return;
    }
    console.error("Бот Max: не удалось связаться с Max, пробую дальше", err);
  }
  await maxApi
    .setCommands([
      { name: "start", description: "Начать" },
      { name: "app", description: "Открыть приложение" },
      { name: "help", description: "Как это работает" },
    ])
    .catch(() => undefined);
  void pollLoop();
}

async function pollLoop() {
  let marker: number | undefined;
  let delay = 5000;
  while (!stopped) {
    try {
      const r = await maxApi.getUpdates(marker);
      if (r.marker !== undefined && r.marker !== null) marker = r.marker;
      delay = 5000;
      for (const u of r.updates ?? []) {
        await handleMaxUpdate(u).catch((err) => console.error("Бот Max: ошибка обработки", err));
      }
    } catch (err) {
      if (err instanceof MaxError && err.status === 401) {
        console.error("Бот Max остановлен: Max не принял MAX_BOT_TOKEN.");
        return;
      }
      console.error(`Бот Max: нет связи с Max, повтор через ${delay / 1000} с`, (err as Error).message);
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 60000);
    }
  }
}

export function stopMaxBot() {
  stopped = true;
}
