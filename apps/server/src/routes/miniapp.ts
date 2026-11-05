import type { FastifyInstance, FastifyRequest } from "fastify";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { InputFile } from "grammy";
import type { User } from "@prisma/client";
import { prisma } from "../lib/db.js";
import { config } from "../config.js";
import { validateInitData } from "../lib/telegramAuth.js";
import { verifyWebSession } from "../lib/webAuth.js";
import { isValidTimezone } from "../lib/dates.js";
import {
  activeChallengeCounts,
  challengeLeaderboard,
  currentDayOf,
  grantAccess,
  enrollmentsByChallenge,
  enrollmentState,
  joinStartDate,
  primaryEnrollment,
  recomputeEnrollment,
  sameDayLeaderboard,
  serializeDay,
  serializeReport,
  type EnrollmentFull,
} from "../services/enrollments.js";
import { bot, sendTo } from "../bot/index.js";
import { esc, openAppKeyboard } from "../bot/messages.js";
import {
  CHAT_TEXT_MAX,
  chatInclude,
  chatMembersCount,
  chatSnippet,
  chatSummary,
  loadMessages,
  markRead,
  rateLimited,
  serializeMessages,
  shouldNotify,
} from "../services/chat.js";

declare module "fastify" {
  interface FastifyRequest {
    tgUser?: User;
  }
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const GOALS = ["lose_weight", "habit", "nutrition", "willpower", "other"];

export async function saveUpload(buf: Buffer, ext: string, folder: string) {
  const name = `${crypto.randomBytes(16).toString("hex")}.${ext}`;
  const dir = path.join(config.uploadsDir, folder);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, name), buf);
  return `/uploads/${folder}/${name}`;
}

export function imageExt(mime: string): string | null {
  return ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic" } as Record<string, string>)[mime] ?? null;
}

async function authenticate(req: FastifyRequest): Promise<User> {
  const auth = req.headers.authorization ?? "";
  // Сайт в обычном браузере: токен, выданный после входа через бота
  if (auth.startsWith("web ")) {
    const id = verifyWebSession(auth.slice(4), config.botToken);
    const user = id ? await prisma.user.findUnique({ where: { id } }) : null;
    if (!user) throw new HttpError(401, "Войдите через Telegram");
    return user;
  }
  let tg: { id: number; username?: string; first_name?: string; last_name?: string; photo_url?: string } | null = null;
  if (auth.startsWith("tma ")) {
    tg = validateInitData(auth.slice(4), config.botToken);
  } else if (config.devAuth && req.headers["x-dev-user"]) {
    tg = { id: Number(req.headers["x-dev-user"]), first_name: "Dev" };
  }
  if (!tg) throw new HttpError(401, "Откройте приложение из Telegram");
  return prisma.user.upsert({
    where: { telegramId: BigInt(tg.id) },
    create: {
      telegramId: BigInt(tg.id),
      username: tg.username,
      firstName: tg.first_name,
      lastName: tg.last_name,
      photoUrl: tg.photo_url,
    },
    update: { username: tg.username, firstName: tg.first_name, lastName: tg.last_name, photoUrl: tg.photo_url },
  });
}

async function loadEnrollment(user: User, id: number): Promise<EnrollmentFull> {
  const e = await prisma.enrollment.findUnique({
    where: { id },
    include: { user: true, stream: { include: { challenge: true } } },
  });
  if (!e || e.userId !== user.id || e.status === "CANCELLED") throw new HttpError(404, "Участие не найдено");
  return e;
}

function serializeUser(u: User) {
  return {
    id: u.id,
    telegramId: String(u.telegramId),
    username: u.username,
    firstName: u.firstName,
    photoUrl: u.photoUrl,
    displayName: u.displayName,
    age: u.age,
    country: u.country,
    goal: u.goal,
    goalOther: u.goalOther,
    timezone: u.timezone,
    onboarded: u.onboarded,
    isOrganizer: u.isOrganizer,
  };
}

export async function miniappRoutes(app: FastifyInstance) {
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.message });
    app.log.error(err);
    return reply.status(500).send({ error: "Внутренняя ошибка" });
  });

  app.addHook("preHandler", async (req) => {
    req.tgUser = await authenticate(req);
  });

  app.get("/me", async (req) => {
    const user = req.tgUser!;
    const primary = await primaryEnrollment(user.id);
    const all = await prisma.enrollment.findMany({
      where: { userId: user.id, status: { in: ["ACTIVE", "COMPLETED"] } },
      include: { user: true, stream: { include: { challenge: true } } },
      orderBy: { createdAt: "desc" },
    });
    const mine = enrollmentsByChallenge(all).sort(
      (a, b) => a.e.stream.challenge.sortOrder - b.e.stream.challenge.sortOrder || a.e.stream.challengeId - b.e.stream.challengeId,
    );
    return {
      user: serializeUser(user),
      botUsername: config.botUsername,
      primaryEnrollmentId: primary?.id ?? null,
      /** По одному участию на челлендж: между ними участник переключается на главной */
      enrollments: mine.map(({ e, phase, day }) => ({
        id: e.id,
        challengeId: e.stream.challengeId,
        challengeTitle: e.stream.challenge.title,
        durationDays: e.stream.challenge.durationDays,
        startDate: e.startDate,
        status: e.status,
        points: e.points,
        phase,
        day,
      })),
    };
  });

  app.post("/profile", async (req) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const displayName = String(b.displayName ?? "").trim().slice(0, 32);
    if (!displayName) throw new HttpError(400, "Укажи имя для рейтинга");
    const age = b.age === null || b.age === "" || b.age === undefined ? null : Number(b.age);
    if (age !== null && (!Number.isInteger(age) || age < 6 || age > 120)) throw new HttpError(400, "Неверный возраст");
    const goal = b.goal ? String(b.goal) : null;
    if (goal && !GOALS.includes(goal)) throw new HttpError(400, "Неверная цель");
    const tz = b.timezone ? String(b.timezone) : undefined;
    const user = await prisma.user.update({
      where: { id: req.tgUser!.id },
      data: {
        displayName,
        age,
        country: b.country ? String(b.country).slice(0, 64) : null,
        goal,
        goalOther: goal === "other" ? String(b.goalOther ?? "").slice(0, 200) : null,
        ...(tz && isValidTimezone(tz) ? { timezone: tz } : {}),
        onboarded: true,
      },
    });
    return { user: serializeUser(user) };
  });

  /** Таймзона приходит при каждом открытии, чтобы напоминания шли по местному времени */
  app.post("/timezone", async (req) => {
    const tz = String((req.body as any)?.timezone ?? "");
    if (isValidTimezone(tz) && tz !== req.tgUser!.timezone) {
      await prisma.user.update({ where: { id: req.tgUser!.id }, data: { timezone: tz } });
    }
    return { ok: true };
  });

  /** Каталог открытых челленджей; у тех, где участник уже записан, есть его участие */
  app.get("/challenges", async (req) => {
    const user = req.tgUser!;
    const [list, mine] = await Promise.all([
      prisma.challenge.findMany({
        // организатор видит и черновики, чтобы проверить челлендж до запуска
        where: { status: { in: user.isOrganizer ? ["ACTIVE", "DRAFT"] : ["ACTIVE"] } },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      }),
      prisma.enrollment.findMany({
        where: { userId: user.id, status: { in: ["ACTIVE", "COMPLETED"] } },
        include: { user: true, stream: { include: { challenge: true } } },
      }),
    ]);
    const joined = new Map(enrollmentsByChallenge(mine).map((x) => [x.e.stream.challengeId, x]));
    const out = [];
    for (const ch of list) {
      const j = joined.get(ch.id);
      out.push({
        id: ch.id,
        slug: ch.slug,
        title: ch.title,
        tagline: ch.tagline,
        coverUrl: ch.coverUrl,
        priceRub: ch.priceRub,
        paymentMode: ch.paymentMode,
        tributeLink: ch.tributeLink,
        /** Когда начнутся 30 дней, если записаться сейчас */
        nextStart: joinStartDate(ch, user.timezone),
        joined: j ? { enrollmentId: j.e.id, phase: j.phase, startDate: j.e.startDate } : null,
        draft: ch.status === "DRAFT",
      });
    }
    return { challenges: out, botUsername: config.botUsername, organizer: user.isOrganizer };
  });

  /** Организатор участвует в любом челлендже бесплатно; его 30 дней начинаются сегодня */
  app.post<{ Params: { id: string } }>("/challenges/:id/join", async (req) => {
    const user = req.tgUser!;
    if (!user.isOrganizer) throw new HttpError(403, "Участие открывается после оплаты");
    const ch = await prisma.challenge.findUnique({ where: { id: Number(req.params.id) } });
    if (!ch || ch.status === "ARCHIVED") throw new HttpError(404, "Челлендж не найден");
    const res = await grantAccess(user.id, ch.id, "organizer", new Date(), { startToday: true });
    return { enrollmentId: res.enrollment.id };
  });

  app.get<{ Params: { id: string } }>("/enrollments/:id", async (req) => {
    const e = await loadEnrollment(req.tgUser!, Number(req.params.id));
    return enrollmentState(e);
  });

  /** Задание дня (только уже открытые дни) */
  app.get<{ Params: { id: string; day: string } }>("/enrollments/:id/days/:day", async (req) => {
    const e = await loadEnrollment(req.tgUser!, Number(req.params.id));
    const n = Number(req.params.day);
    const cur = currentDayOf(e);
    if (!Number.isInteger(n) || n < 1 || n > Math.min(cur, e.stream.challenge.durationDays)) {
      throw new HttpError(403, "Этот день ещё не открыт");
    }
    const day = await prisma.challengeDay.findUnique({
      where: { challengeId_dayNumber: { challengeId: e.stream.challengeId, dayNumber: n } },
    });
    const report = await prisma.report.findUnique({ where: { enrollmentId_dayNumber: { enrollmentId: e.id, dayNumber: n } } });
    return { day: day && serializeDay(day), report: report && serializeReport(report) };
  });

  /** Отчёт за сегодня: выполнил / нарушил, текст, чек-лист */
  app.post<{ Params: { id: string } }>("/enrollments/:id/report", async (req) => {
    const e = await loadEnrollment(req.tgUser!, Number(req.params.id));
    const day = currentDayOf(e);
    if (day < 1) throw new HttpError(400, "Челлендж ещё не начался");
    if (day > e.stream.challenge.durationDays) throw new HttpError(400, "Челлендж завершён");
    const b = (req.body ?? {}) as { status?: string; proofText?: string; checklistDone?: string[] };
    const status = b.status === "VIOLATED" ? "VIOLATED" : b.status === "DONE" ? "DONE" : null;
    const existing = await prisma.report.findUnique({ where: { enrollmentId_dayNumber: { enrollmentId: e.id, dayNumber: day } } });
    if (!status && !existing) throw new HttpError(400, "Укажи статус");
    const task = await prisma.challengeDay.findUnique({
      where: { challengeId_dayNumber: { challengeId: e.stream.challengeId, dayNumber: day } },
    });
    const checklistDone = Array.isArray(b.checklistDone)
      ? b.checklistDone.map(String).filter((x) => task?.checklist.includes(x))
      : existing?.checklistDone ?? [];
    if ((status ?? existing?.status) === "DONE" && task && task.checklist.length && checklistDone.length < task.checklist.length) {
      throw new HttpError(400, "Отметь все пункты чек-листа");
    }
    const proofText = b.proofText !== undefined ? String(b.proofText).trim().slice(0, 1000) || null : undefined;
    if (existing) {
      await prisma.report.update({
        where: { id: existing.id },
        data: { ...(status ? { status } : {}), ...(proofText !== undefined ? { proofText } : {}), checklistDone },
      });
    } else {
      await prisma.report.create({
        data: { enrollmentId: e.id, dayNumber: day, status: status!, proofText: proofText ?? null, checklistDone },
      });
    }
    await recomputeEnrollment(e.id);
    return enrollmentState(await loadEnrollment(req.tgUser!, e.id));
  });

  /** Фото-доказательство за сегодня */
  app.post<{ Params: { id: string } }>("/enrollments/:id/report/photo", async (req) => {
    const e = await loadEnrollment(req.tgUser!, Number(req.params.id));
    const day = currentDayOf(e);
    const report = await prisma.report.findUnique({ where: { enrollmentId_dayNumber: { enrollmentId: e.id, dayNumber: day } } });
    if (!report) throw new HttpError(400, "Сначала отметь выполнение");
    const file = await req.file();
    if (!file) throw new HttpError(400, "Нет файла");
    const ext = imageExt(file.mimetype);
    if (!ext) throw new HttpError(400, "Нужна картинка JPG, PNG или WEBP");
    const url = await saveUpload(await file.toBuffer(), ext, "proofs");
    await prisma.report.update({ where: { id: report.id }, data: { proofPhoto: url, proofRejected: false } });
    await recomputeEnrollment(e.id);
    return enrollmentState(await loadEnrollment(req.tgUser!, e.id));
  });

  /** «Спасти серию» за баллы */
  app.post<{ Params: { id: string } }>("/enrollments/:id/save-streak", async (req) => {
    const e = await loadEnrollment(req.tgUser!, Number(req.params.id));
    const state = await enrollmentState(e);
    if (!state.canSaveStreak || state.streakBreakDay === null) throw new HttpError(400, "Сейчас серию спасти нельзя");
    await prisma.enrollment.update({
      where: { id: e.id },
      data: { savedDays: { push: state.streakBreakDay }, streakSavesUsed: { increment: 1 } },
    });
    await recomputeEnrollment(e.id);
    return enrollmentState(await loadEnrollment(req.tgUser!, e.id));
  });

  app.get<{ Params: { id: string } }>("/enrollments/:id/leaderboard", async (req) => {
    const e = await loadEnrollment(req.tgUser!, Number(req.params.id));
    const board = await challengeLeaderboard(e.stream.challengeId, e.id);
    const me = board.find((b) => b.enrollmentId === e.id) ?? null;
    const same = await sameDayLeaderboard(e);
    const sameMe = same.rows.find((b) => b.enrollmentId === e.id) ?? null;
    // сколько у каждого челленджей, без названий
    const counts = await activeChallengeCounts([...board.slice(0, 100), ...same.rows.slice(0, 100)].map((r) => r.userId));
    const challengesOf = (userId: number) => counts.get(userId) ?? 1;
    return {
      top: board.slice(0, 100).map(({ userId, ...r }) => ({ ...r, challenges: challengesOf(userId), isMe: r.enrollmentId === e.id })),
      me,
      total: board.length,
      sameDay: {
        day: same.day,
        top: same.rows.slice(0, 100).map(({ userId, ...r }) => ({ ...r, challenges: challengesOf(userId), isMe: r.enrollmentId === e.id })),
        me: sameMe,
        total: same.rows.length,
      },
    };
  });

  /** Mini App рисует сертификат и присылает PNG; бот отправляет его в чат, откуда его легко переслать */
  app.post<{ Params: { id: string } }>("/enrollments/:id/certificate", async (req) => {
    const e = await loadEnrollment(req.tgUser!, Number(req.params.id));
    if (currentDayOf(e) <= e.stream.challenge.durationDays) throw new HttpError(400, "Сертификат доступен после завершения");
    const file = await req.file();
    if (!file || file.mimetype !== "image/png") throw new HttpError(400, "Нужен PNG");
    const buf = await file.toBuffer();
    if (!bot) return { ok: true, sent: false };
    const share = config.botUsername ? `\n\nПрисоединяйся: https://t.me/${config.botUsername}?start=c_${e.stream.challenge.slug}` : "";
    await bot.api.sendPhoto(Number(req.tgUser!.telegramId), new InputFile(buf, "certificate.png"), {
      caption: `Сертификат: «${e.stream.challenge.title}»${share}`,
    });
    return { ok: true, sent: true };
  });

  // ---------------- Чат участников челленджа ----------------
  // Доступ только у тех, у кого есть оплаченное или пройденное участие (loadEnrollment не пускает CANCELLED)

  async function chatContext(req: FastifyRequest<{ Params: { id: string } }>) {
    const e = await loadEnrollment(req.tgUser!, Number(req.params.id));
    if (!e.stream.challenge.chatEnabled) throw new HttpError(403, "Чат этого челленджа выключен");
    return e;
  }

  app.get<{ Params: { id: string }; Querystring: { after?: string; before?: string; from?: string } }>(
    "/enrollments/:id/chat",
    async (req) => {
      const e = await chatContext(req);
      const challengeId = e.stream.challengeId;
      const after = Number(req.query.after) || undefined;
      const before = Number(req.query.before) || undefined;
      const from = Number(req.query.from) || undefined;
      const list = await loadMessages(challengeId, { after, before });
      // при опросе сообщаем, какие уже показанные сообщения удалили
      const deletedIds =
        after && from
          ? (
              await prisma.chatMessage.findMany({
                where: { challengeId, deleted: true, id: { gte: from, lte: after } },
                select: { id: true },
              })
            ).map((m) => m.id)
          : [];
      const hasMore = !after && list.length > 0 && (await prisma.chatMessage.count({ where: { challengeId, id: { lt: list[0].id } } })) > 0;
      return {
        challengeTitle: e.stream.challenge.title,
        messages: await serializeMessages(challengeId, list, req.tgUser!.id),
        deletedIds,
        hasMore,
        members: after ? undefined : await chatMembersCount(challengeId),
        banned: req.tgUser!.chatBanned,
      };
    },
  );

  app.get<{ Params: { id: string } }>("/enrollments/:id/chat/summary", async (req) => {
    const e = await loadEnrollment(req.tgUser!, Number(req.params.id));
    if (!e.stream.challenge.chatEnabled) return { enabled: false };
    return { enabled: true, ...(await chatSummary(req.tgUser!.id, e.stream.challengeId)) };
  });

  app.post<{ Params: { id: string } }>("/enrollments/:id/chat/read", async (req) => {
    const e = await chatContext(req);
    const lastId = Number((req.body as any)?.lastId);
    if (Number.isInteger(lastId) && lastId > 0) await markRead(req.tgUser!.id, e.stream.challengeId, lastId);
    return { ok: true };
  });

  async function postMessage(
    e: EnrollmentFull,
    user: User,
    input: { text: string; replyToId?: number | null; photoUrl?: string | null },
  ) {
    if (user.chatBanned) throw new HttpError(403, "Организатор ограничил вам отправку сообщений");
    const text = input.text.trim().slice(0, CHAT_TEXT_MAX);
    if (!text && !input.photoUrl) throw new HttpError(400, "Пустое сообщение");
    if (rateLimited(user.id)) throw new HttpError(429, "Слишком часто. Подождите немного");
    const challengeId = e.stream.challengeId;
    let replyTo = null;
    if (input.replyToId) {
      replyTo = await prisma.chatMessage.findUnique({ where: { id: input.replyToId }, include: { user: true } });
      if (!replyTo || replyTo.challengeId !== challengeId) replyTo = null;
    }
    const msg = await prisma.chatMessage.create({
      data: { challengeId, userId: user.id, text, photoUrl: input.photoUrl ?? null, replyToId: replyTo?.id ?? null },
      include: chatInclude,
    });
    await markRead(user.id, challengeId, msg.id);

    // «Вам ответили» — бот присылает уведомление автору исходного сообщения
    const target = replyTo?.user;
    if (target && target.id !== user.id && !target.botBlocked && shouldNotify(target.id)) {
      const targetEnrollment = await prisma.enrollment.findFirst({
        where: { userId: target.id, stream: { challengeId }, status: { in: ["ACTIVE", "COMPLETED"] } },
        orderBy: { startDate: "desc" },
      });
      if (targetEnrollment) {
        const who = esc(user.displayName || user.firstName || "Участник");
        const what = esc(chatSnippet(msg));
        void sendTo(
          target.telegramId,
          `💬 <b>${who}</b> ответил(а) вам в чате «${esc(e.stream.challenge.title)}»:\n\n${what}`,
          openAppKeyboard("ОТКРЫТЬ ЧАТ", { screen: "chat", enrollment: String(targetEnrollment.id) }),
        ).catch(() => undefined);
      }
    }
    const [out] = await serializeMessages(challengeId, [msg], user.id);
    return { message: out };
  }

  app.post<{ Params: { id: string } }>("/enrollments/:id/chat", async (req) => {
    const e = await chatContext(req);
    const b = (req.body ?? {}) as { text?: unknown; replyToId?: unknown };
    return postMessage(e, req.tgUser!, { text: String(b.text ?? ""), replyToId: Number(b.replyToId) || null });
  });

  /** Фото в чат; подпись и ответ приходят полями формы перед файлом */
  app.post<{ Params: { id: string } }>("/enrollments/:id/chat/photo", async (req) => {
    const e = await chatContext(req);
    if (req.tgUser!.chatBanned) throw new HttpError(403, "Организатор ограничил вам отправку сообщений");
    const file = await req.file();
    if (!file) throw new HttpError(400, "Нет файла");
    const ext = imageExt(file.mimetype);
    if (!ext) throw new HttpError(400, "Нужна картинка JPG, PNG или WEBP");
    const field = (name: string) => {
      const f = (file.fields as Record<string, any>)[name];
      return f && "value" in f ? String(f.value) : "";
    };
    const url = await saveUpload(await file.toBuffer(), ext, "chat");
    return postMessage(e, req.tgUser!, { text: field("text"), replyToId: Number(field("replyToId")) || null, photoUrl: url });
  });

  /** Удалить своё сообщение */
  app.post<{ Params: { id: string; msgId: string } }>("/enrollments/:id/chat/:msgId/delete", async (req) => {
    const e = await chatContext(req);
    const m = await prisma.chatMessage.findUnique({ where: { id: Number(req.params.msgId) } });
    if (!m || m.challengeId !== e.stream.challengeId || m.userId !== req.tgUser!.id) throw new HttpError(404, "Сообщение не найдено");
    await prisma.chatMessage.update({ where: { id: m.id }, data: { deleted: true } });
    return { ok: true };
  });
}
