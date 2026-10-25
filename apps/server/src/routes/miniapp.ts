import type { FastifyInstance, FastifyRequest } from "fastify";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { InputFile } from "grammy";
import type { User } from "@prisma/client";
import { prisma } from "../lib/db.js";
import { config } from "../config.js";
import { validateInitData } from "../lib/telegramAuth.js";
import { isValidTimezone } from "../lib/dates.js";
import {
  challengeLeaderboard,
  currentDayOf,
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
import { bot } from "../bot/index.js";

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
        where: { status: "ACTIVE" },
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
      });
    }
    return { challenges: out, botUsername: config.botUsername };
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
    return {
      top: board.slice(0, 100).map(({ userId: _u, ...r }) => ({ ...r, isMe: r.enrollmentId === e.id })),
      me,
      total: board.length,
      sameDay: {
        day: same.day,
        top: same.rows.slice(0, 100).map(({ userId: _u, ...r }) => ({ ...r, isMe: r.enrollmentId === e.id })),
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
}
