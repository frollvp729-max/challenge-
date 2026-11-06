import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/db.js";
import { config } from "../config.js";
import { safeEqual, signAdminToken, verifyAdminToken } from "../lib/telegramAuth.js";
import { localDate } from "../lib/dates.js";
import { challengeLeaderboard, currentDayOf, displayNameOf, grantAccess, recomputeEnrollment } from "../services/enrollments.js";
import { enrollPaidUsers } from "../services/payments.js";
import { sendTo } from "../bot/index.js";
import { esc, openAppKeyboard, paidMessage } from "../bot/messages.js";
import { imageExt, saveUpload } from "./miniapp.js";
import { CHAT_TEXT_MAX, chatInclude, loadMessages, serializeMessages } from "../services/chat.js";
import { getCardSettings, saveCardSettings } from "../services/cardPay.js";
import { normalizeEmail } from "../lib/webAuth.js";
import { notifyUser } from "../services/notify.js";

const CHALLENGE_FIELDS = [
  "slug", "title", "tagline", "intro", "rules", "coverUrl", "status", "durationDays", "priceRub", "paymentMode",
  "tributeLink", "tributeSubscriptionId", "tributeProductId", "chatLink", "morningHour", "eveningHour", "startDate",
  "pointsDone", "pointsProof", "pointsViolation", "streakSaveCost", "streakSavesAllowed", "sortOrder", "chatEnabled",
] as const;
const DAY_FIELDS = ["title", "description", "task", "hint", "imageUrl", "points", "proofType", "proofPrompt", "proofRequired", "checklist"] as const;
const INT_FIELDS = new Set([
  "durationDays", "priceRub", "tributeSubscriptionId", "tributeProductId", "morningHour", "eveningHour",
  "pointsDone", "pointsProof", "pointsViolation", "streakSaveCost", "streakSavesAllowed", "sortOrder", "points",
]);
const NULLABLE = new Set(["startDate", "coverUrl", "tributeLink", "tributeSubscriptionId", "tributeProductId", "chatLink", "imageUrl", "points"]);

/**
 * Человек по @username (только тот, кто уже открывал бота) или по Telegram ID
 * (если такого ещё нет, создаём: доступ появится, когда он откроет бота).
 */
async function userByWho(raw: unknown) {
  const who = String(raw ?? "").trim().replace(/^https?:\/\/t\.me\//, "").replace(/^@/, "");
  if (!who) throw Object.assign(new Error("Укажите @username, Telegram ID или почту"), { statusCode: 400 });
  // аккаунт сайта по почте
  if (who.includes("@")) {
    const email = normalizeEmail(who);
    const u = email ? await prisma.user.findUnique({ where: { email } }) : null;
    if (!u) throw Object.assign(new Error(`На сайте нет аккаунта с почтой ${who}`), { statusCode: 400 });
    return u;
  }
  if (/^\d+$/.test(who)) {
    if (who.length < 5 || who.length > 15) throw Object.assign(new Error(`Telegram ID ${who} не похож на настоящий: это число из 5–15 цифр`), { statusCode: 400 });
    const tgId = BigInt(who);
    return prisma.user.upsert({ where: { telegramId: tgId }, create: { telegramId: tgId }, update: {} });
  }
  const found = await prisma.user.findMany({ where: { username: { equals: who, mode: "insensitive" } } });
  if (found.length !== 1) {
    throw Object.assign(new Error(`Пользователь @${who} не найден. Пусть он сначала откроет бота и нажмёт «Старт», или укажите его Telegram ID`), { statusCode: 400 });
  }
  return found[0];
}

function pick(body: any, fields: readonly string[]) {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (body?.[f] === undefined) continue;
    let v = body[f];
    if (NULLABLE.has(f) && (v === "" || v === null)) v = null;
    else if (INT_FIELDS.has(f)) {
      v = Number(v);
      if (!Number.isFinite(v)) throw Object.assign(new Error(`Поле ${f} должно быть числом`), { statusCode: 400 });
      v = Math.trunc(v as number);
    } else if (f === "checklist") v = (Array.isArray(v) ? v : String(v).split("\n")).map((x: unknown) => String(x).trim()).filter(Boolean);
    else if (f === "proofRequired" || f === "chatEnabled") v = Boolean(v);
    if (f === "startDate" && v !== null && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) {
      throw Object.assign(new Error("Дата открытия в формате ГГГГ-ММ-ДД"), { statusCode: 400 });
    }
    out[f] = v;
  }
  return out;
}

const SOURCE_LABELS: Record<string, string> = {
  organizer: "организатор (бесплатно)",
  admin: "выдан вручную",
  free: "бесплатный челлендж",
  tribute_product: "разовая покупка",
  tribute_subscription: "подписка",
  card: "перевод на карту",
};

const json = (x: unknown) => JSON.parse(JSON.stringify(x, (_k, v) => (typeof v === "bigint" ? String(v) : v)));

export async function adminRoutes(app: FastifyInstance) {
  app.setErrorHandler((err: any, _req, reply) => {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return reply.status(400).send({ error: `Значение уже занято: ${(err.meta?.target as string[] | undefined)?.join(", ")}` });
    }
    const status = err.statusCode ?? 500;
    if (status >= 500) app.log.error(err);
    return reply.status(status).send({ error: status >= 500 ? "Внутренняя ошибка" : err.message });
  });

  app.post("/login", async (req, reply) => {
    const password = String((req.body as any)?.password ?? "");
    if (!config.adminPassword) return reply.status(503).send({ error: "ADMIN_PASSWORD не задан на сервере" });
    if (!safeEqual(password, config.adminPassword)) return reply.status(401).send({ error: "Неверный пароль" });
    return { token: signAdminToken(config.adminPassword) };
  });

  app.addHook("preHandler", async (req, reply) => {
    if (req.routeOptions.url?.endsWith("/login")) return;
    const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
    if (!verifyAdminToken(token, config.adminPassword)) return reply.status(401).send({ error: "Нужен вход" });
  });

  // ---------- Статистика ----------
  app.get("/stats", async () => {
    const today = localDate(new Date(), config.defaultTimezone);
    const [users, enrollments, payments, challenges] = await Promise.all([
      prisma.user.count(),
      prisma.enrollment.count({ where: { status: { in: ["ACTIVE", "COMPLETED"] } } }),
      prisma.payment.findMany({ where: { event: { in: ["new_subscription", "renewed_subscription", "new_digital_product"] } } }),
      prisma.challenge.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    ]);
    const revenue = payments.filter((p) => !p.currency || p.currency.toLowerCase() === "rub").reduce((s, p) => s + (p.amount ?? 0), 0);
    // По челленджам: у каждого участника свой день, поэтому считаем по личным дням
    const live = await prisma.enrollment.findMany({
      where: { status: { in: ["ACTIVE", "COMPLETED"] } },
      include: { user: { select: { timezone: true } }, stream: { select: { challengeId: true } } },
    });
    const now = new Date();
    const byChallenge = [];
    for (const ch of challenges) {
      const mine = live.filter((e) => e.stream.challengeId === ch.id);
      let running = 0;
      let upcoming = 0;
      let finished = 0;
      const todayDays: { id: number; day: number }[] = [];
      for (const e of mine) {
        const day = currentDayOf(e, now);
        if (day < 1) upcoming++;
        else if (day > ch.durationDays) finished++;
        else {
          running++;
          todayDays.push({ id: e.id, day });
        }
      }
      let reportedToday = 0;
      if (todayDays.length) {
        reportedToday = await prisma.report.count({
          where: { OR: todayDays.map((x) => ({ enrollmentId: x.id, dayNumber: x.day })) },
        });
      }
      if (!mine.length && ch.status === "DRAFT") continue;
      byChallenge.push({
        id: ch.id,
        challenge: ch.title,
        startDate: ch.startDate,
        running,
        upcoming,
        finished,
        participants: mine.length,
        reportedToday,
      });
    }
    return {
      today,
      users,
      enrollments,
      paymentsCount: payments.length,
      revenue,
      newUsers7d: await prisma.user.count({ where: { createdAt: { gt: new Date(Date.now() - 7 * 86400_000) } } }),
      byChallenge,
    };
  });

  // ---------- Челленджи ----------
  app.get("/challenges", async () => {
    const list = await prisma.challenge.findMany({
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      include: { _count: { select: { days: true } }, streams: { include: { _count: { select: { enrollments: true } } } } },
    });
    return list.map((c) => ({
      ...c,
      daysCount: c._count.days,
      participants: c.streams.reduce((s, x) => s + x._count.enrollments, 0),
    }));
  });

  app.get<{ Params: { id: string } }>("/challenges/:id", async (req) => {
    const c = await prisma.challenge.findUniqueOrThrow({
      where: { id: Number(req.params.id) },
      include: {
        days: { orderBy: { dayNumber: "asc" } },
        streams: { include: { _count: { select: { enrollments: true } } } },
      },
    });
    const { streams, ...rest } = c;
    return { ...rest, participants: streams.reduce((s, x) => s + x._count.enrollments, 0) };
  });

  app.post("/challenges", async (req) => {
    const data = pick(req.body, CHALLENGE_FIELDS) as Prisma.ChallengeCreateInput;
    if (!data.title || !data.slug) throw Object.assign(new Error("Нужны название и slug"), { statusCode: 400 });
    return prisma.challenge.create({ data });
  });

  app.put<{ Params: { id: string } }>("/challenges/:id", async (req) => {
    const data = pick(req.body, CHALLENGE_FIELDS);
    const ch = await prisma.challenge.update({ where: { id: Number(req.params.id) }, data });
    // вписали subscription_id / product_id — записать тех, кто уже оплатил
    const { enrolled } = data.tributeSubscriptionId || data.tributeProductId ? await enrollPaidUsers(ch.id) : { enrolled: 0 };
    return { ...ch, enrolled };
  });

  /** Создать недостающие дни (1..durationDays) по шаблону */
  app.post<{ Params: { id: string } }>("/challenges/:id/days/generate", async (req) => {
    const c = await prisma.challenge.findUniqueOrThrow({ where: { id: Number(req.params.id) } });
    const existing = new Set((await prisma.challengeDay.findMany({ where: { challengeId: c.id } })).map((d) => d.dayNumber));
    const data = [];
    for (let n = 1; n <= c.durationDays; n++) {
      if (existing.has(n)) continue;
      data.push({ challengeId: c.id, dayNumber: n, title: `День ${n}`, task: c.tagline });
    }
    await prisma.challengeDay.createMany({ data });
    return { created: data.length };
  });

  app.put<{ Params: { dayId: string } }>("/days/:dayId", async (req) => {
    const day = await prisma.challengeDay.update({ where: { id: Number(req.params.dayId) }, data: pick(req.body, DAY_FIELDS) });
    // очки дня могли поменяться — пересчитать участия этого челленджа
    if ((req.body as any)?.points !== undefined) {
      const es = await prisma.enrollment.findMany({ where: { stream: { challengeId: day.challengeId } }, select: { id: true } });
      for (const e of es) await recomputeEnrollment(e.id);
    }
    return day;
  });

  /** Загрузка картинки (обложка, картинка дня) */
  app.post("/upload", async (req) => {
    const file = await req.file();
    if (!file) throw Object.assign(new Error("Нет файла"), { statusCode: 400 });
    const ext = imageExt(file.mimetype);
    if (!ext) throw Object.assign(new Error("Нужна картинка"), { statusCode: 400 });
    const url = await saveUpload(await file.toBuffer(), ext, "media");
    return { url: config.publicUrl + url };
  });

  app.post<{ Params: { id: string } }>("/challenges/:id/enroll-paid", async (req) => enrollPaidUsers(Number(req.params.id)));

  app.get<{ Params: { id: string } }>("/challenges/:id/leaderboard", async (req) => challengeLeaderboard(Number(req.params.id)));

  // ---------- Участники ----------
  app.get<{ Querystring: { q?: string; challengeId?: string } }>("/participants", async (req) => {
    const { q, challengeId } = req.query;
    const where: Prisma.EnrollmentWhereInput = {};
    if (challengeId) where.stream = { challengeId: Number(challengeId) };
    if (q) {
      const or: Prisma.UserWhereInput[] = [
        { username: { contains: q, mode: "insensitive" } },
        { firstName: { contains: q, mode: "insensitive" } },
        { displayName: { contains: q, mode: "insensitive" } },
      ];
      if (/^\d+$/.test(q)) or.push({ telegramId: BigInt(q) });
      where.user = { OR: or };
    }
    const list = await prisma.enrollment.findMany({
      where,
      include: { user: { include: { subscriptions: true } }, stream: { include: { challenge: true } } },
      orderBy: [{ points: "desc" }],
      take: 500,
    });
    const boards = new Map<number, Map<number, number>>();
    const out = [];
    for (const e of list) {
      const chId = e.stream.challengeId;
      if (!boards.has(chId)) {
        boards.set(chId, new Map((await challengeLeaderboard(chId)).map((r) => [r.enrollmentId, r.rank])));
      }
      const sub = e.user.subscriptions.find((s) => s.tributeSubscriptionId === e.stream.challenge.tributeSubscriptionId);
      out.push({
        enrollmentId: e.id,
        userId: e.userId,
        telegramId: e.user.telegramId === null ? null : String(e.user.telegramId),
        email: e.user.email,
        username: e.user.username,
        name: displayNameOf(e.user),
        displayName: e.user.displayName,
        seenBot: Boolean(e.user.firstName || e.user.username || e.user.onboarded),
        registeredAt: e.user.createdAt,
        goal: e.user.goal,
        challenge: e.stream.challenge.title,
        challengeId: chId,
        durationDays: e.stream.challenge.durationDays,
        streamStart: e.startDate,
        source: e.source,
        payment: sub
          ? `${sub.status === "active" ? "активна" : "отменена"} до ${sub.expiresAt.toISOString().slice(0, 10)}`
          : SOURCE_LABELS[e.source] ?? e.source,
        day: currentDayOf(e),
        currentStreak: e.currentStreak,
        bestStreak: e.bestStreak,
        points: e.points,
        doneCount: e.doneCount,
        rank: boards.get(chId)!.get(e.id) ?? null,
        status: e.status,
        botBlocked: e.user.botBlocked,
      });
    }
    return out;
  });

  /** Ручная выдача доступа без оплаты (подарок, тест, оплата мимо Tribute) */
  app.post("/participants", async (req) => {
    const b = (req.body ?? {}) as any;
    const challengeId = Number(b.challengeId);
    if (!challengeId) throw Object.assign(new Error("Выберите челлендж"), { statusCode: 400 });
    const ch = await prisma.challenge.findUnique({ where: { id: challengeId } });
    if (!ch) throw Object.assign(new Error("Челлендж не найден"), { statusCode: 404 });
    const user = await userByWho(b.who ?? b.telegramId);
    const res = await grantAccess(user.id, ch.id, "admin", new Date(), { startToday: Boolean(b.startToday) });
    // бот может написать только тому, кто уже нажимал «Старт»
    const seenBot = Boolean(user.firstName || user.username || user.onboarded);
    let notified: boolean | null = null;
    if (res.created && b.notify !== false && !seenBot) notified = false;
    else if (res.created && b.notify !== false) {
      const m = paidMessage(res.startDate, user.timezone);
      const text = [`Тебе открыт доступ к челленджу «${esc(ch.title)}».`, ...m.text.split("\n").slice(2)].join("\n");
      notified = await sendTo(user.telegramId, text, openAppKeyboard("ОТКРЫТЬ ЧЕЛЛЕНДЖ", { enrollment: String(res.enrollment.id) }));
    }
    return {
      enrollmentId: res.enrollment.id,
      created: res.created,
      startDate: res.startDate,
      name: displayNameOf(user),
      telegramId: user.telegramId === null ? null : String(user.telegramId),
      seenBot,
      notified,
    };
  });

  /** Изменить участника: имя (во всех его челленджах), день 1, статус */
  app.put<{ Params: { id: string } }>("/participants/:id", async (req) => {
    const b = (req.body ?? {}) as any;
    const id = Number(req.params.id);
    const e = await prisma.enrollment.findUnique({ where: { id } });
    if (!e) throw Object.assign(new Error("Участие не найдено"), { statusCode: 404 });
    const data: Prisma.EnrollmentUpdateInput = {};
    if (b.status !== undefined) {
      const status = String(b.status);
      if (!["ACTIVE", "COMPLETED", "CANCELLED"].includes(status)) throw Object.assign(new Error("Неверный статус"), { statusCode: 400 });
      data.status = status as any;
    }
    const startChanged = b.startDate !== undefined && String(b.startDate) !== e.startDate;
    if (startChanged) {
      const d = String(b.startDate);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d))) {
        throw Object.assign(new Error("День 1 в формате ГГГГ-ММ-ДД"), { statusCode: 400 });
      }
      data.startDate = d;
      data.finishedNotified = false;
    }
    if (b.name !== undefined) {
      const name = String(b.name).trim().slice(0, 32);
      await prisma.user.update({ where: { id: e.userId }, data: { displayName: name || null } });
    }
    try {
      await prisma.enrollment.update({ where: { id }, data });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw Object.assign(new Error("У этого участника уже есть участие в этом челлендже с таким днём 1"), { statusCode: 400 });
      }
      throw err;
    }
    // серия, баллы и «завершил» зависят от дня 1
    if (startChanged) await recomputeEnrollment(id);
    return { ok: true };
  });

  /**
   * Удалить участие вместе с отчётами и баллами. Записи об оплатах остаются в «Платежах».
   * Если человек ни разу не открывал бота и больше нигде не участвует (например, Telegram ID введён с ошибкой),
   * убираем и его самого.
   */
  app.post<{ Params: { id: string } }>("/participants/:id/delete", async (req) => {
    const id = Number(req.params.id);
    const e = await prisma.enrollment.findUnique({
      where: { id },
      include: { user: { include: { _count: { select: { enrollments: true, payments: true, subscriptions: true, chatMessages: true } } } } },
    });
    if (!e) throw Object.assign(new Error("Участие не найдено"), { statusCode: 404 });
    await prisma.enrollment.delete({ where: { id } });
    const u = e.user;
    const c = u._count;
    const empty = c.enrollments === 1 && !c.payments && !c.subscriptions && !c.chatMessages;
    const neverOpenedBot = !u.onboarded && !u.firstName && !u.username && !u.isOrganizer;
    let userRemoved = false;
    if (empty && neverOpenedBot) {
      await prisma.user.delete({ where: { id: u.id } });
      userRemoved = true;
    }
    return { ok: true, userRemoved };
  });

  // ---------- Организаторы: бесплатный доступ ко всем челленджам ----------
  const serializeOrganizer = (u: { id: number; telegramId: bigint | null; username: string | null; displayName: string | null; firstName: string | null }) => ({
    id: u.id,
    telegramId: u.telegramId === null ? null : String(u.telegramId),
    username: u.username,
    name: displayNameOf(u),
  });

  app.get("/organizers", async () =>
    (await prisma.user.findMany({ where: { isOrganizer: true }, orderBy: { id: "asc" } })).map(serializeOrganizer),
  );

  /** Назначить организатора по @username (он уже открывал бота) или по Telegram ID */
  app.post("/organizers", async (req) => {
    const found = await userByWho((req.body as any)?.who);
    const user = await prisma.user.update({ where: { id: found.id }, data: { isOrganizer: true } });
    return serializeOrganizer(user);
  });

  app.post<{ Params: { id: string } }>("/organizers/:id/remove", async (req) => {
    await prisma.user.update({ where: { id: Number(req.params.id) }, data: { isOrganizer: false } });
    return { ok: true };
  });

  // ---------- Чаты участников ----------
  app.get<{ Querystring: { challengeId?: string; before?: string } }>("/chat", async (req) => {
    const challengeId = Number(req.query.challengeId);
    if (!challengeId) throw Object.assign(new Error("Выбери челлендж"), { statusCode: 400 });
    const list = await loadMessages(challengeId, { before: Number(req.query.before) || undefined });
    const messages = await serializeMessages(challengeId, list, null);
    // админ видит и удалённый текст, чтобы понимать, что убрали
    const raw = new Map(list.map((m) => [m.id, m]));
    return messages.map((m) => ({ ...m, text: raw.get(m.id)!.text, photoUrl: raw.get(m.id)!.photoUrl }));
  });

  /** Сообщение от организатора */
  app.post("/chat", async (req) => {
    const b = (req.body ?? {}) as { challengeId?: unknown; text?: unknown; replyToId?: unknown };
    const challengeId = Number(b.challengeId);
    const text = String(b.text ?? "").trim().slice(0, CHAT_TEXT_MAX);
    if (!challengeId || !text) throw Object.assign(new Error("Выбери челлендж и напиши текст"), { statusCode: 400 });
    const replyToId = Number(b.replyToId) || null;
    const msg = await prisma.chatMessage.create({ data: { challengeId, userId: null, text, replyToId }, include: chatInclude });
    return (await serializeMessages(challengeId, [msg], null))[0];
  });

  app.post<{ Params: { id: string } }>("/chat/:id/delete", async (req) => {
    const deleted = (req.body as any)?.deleted !== false;
    await prisma.chatMessage.update({ where: { id: Number(req.params.id) }, data: { deleted } });
    return { ok: true };
  });

  /** Запретить или разрешить человеку писать во все чаты */
  app.post<{ Params: { userId: string } }>("/chat/users/:userId/ban", async (req) => {
    const banned = (req.body as any)?.banned !== false;
    await prisma.user.update({ where: { id: Number(req.params.userId) }, data: { chatBanned: banned } });
    return { ok: true, banned };
  });

  // ---------- Результаты (отчёты) ----------
  app.get<{ Querystring: { challengeId?: string; day?: string; withProof?: string } }>("/reports", async (req) => {
    const where: Prisma.ReportWhereInput = {};
    if (req.query.challengeId) where.enrollment = { stream: { challengeId: Number(req.query.challengeId) } };
    if (req.query.day) where.dayNumber = Number(req.query.day);
    if (req.query.withProof === "1") where.OR = [{ proofPhoto: { not: null } }, { proofText: { not: null } }];
    const list = await prisma.report.findMany({
      where,
      include: { enrollment: { include: { user: true, stream: { include: { challenge: true } } } } },
      orderBy: { updatedAt: "desc" },
      take: 300,
    });
    return list.map((r) => ({
      id: r.id,
      dayNumber: r.dayNumber,
      status: r.status,
      proofPhoto: r.proofPhoto,
      proofText: r.proofText,
      proofRejected: r.proofRejected,
      checklistDone: r.checklistDone,
      createdAt: r.createdAt,
      name: displayNameOf(r.enrollment.user),
      username: r.enrollment.user.username,
      challenge: r.enrollment.stream.challenge.title,
    }));
  });

  /** Отклонить/вернуть доказательство: баллы за него снимаются или возвращаются */
  app.put<{ Params: { id: string } }>("/reports/:id", async (req) => {
    const r = await prisma.report.update({
      where: { id: Number(req.params.id) },
      data: { proofRejected: Boolean((req.body as any)?.proofRejected) },
    });
    await recomputeEnrollment(r.enrollmentId);
    return r;
  });

  // ---------- Рассылки ----------
  app.get("/broadcasts", async () => prisma.broadcast.findMany({ orderBy: { id: "desc" }, take: 50 }));
  app.post("/broadcasts", async (req) => {
    const b = req.body as any;
    const text = String(b?.text ?? "").trim();
    if (!text) throw Object.assign(new Error("Пустой текст"), { statusCode: 400 });
    return prisma.broadcast.create({
      data: {
        text,
        audience: ["all", "challenge", "stream"].includes(b.audience) ? b.audience : "all",
        challengeId: b.challengeId ? Number(b.challengeId) : null,
        streamId: b.streamId ? Number(b.streamId) : null,
        buttonText: b.buttonText ? String(b.buttonText).slice(0, 40) : null,
      },
    });
  });

  // ---------- Платежи ----------
  app.get("/payments", async () =>
    json(await prisma.payment.findMany({ orderBy: { id: "desc" }, take: 200, include: { user: true } })),
  );

  // ---------- Оплата переводом на карту ----------
  app.get("/card-settings", async () => getCardSettings());
  app.put("/card-settings", async (req) => {
    await saveCardSettings((req.body ?? {}) as Record<string, string>);
    return getCardSettings();
  });

  app.get("/card-payments", async () => {
    const list = await prisma.cardPayment.findMany({
      orderBy: [{ status: "asc" }, { id: "desc" }],
      take: 200,
      include: { user: true, challenge: { select: { title: true } } },
    });
    // сначала ожидающие подтверждения
    list.sort((a, b) => Number(b.status === "pending") - Number(a.status === "pending"));
    return list.map((p) => ({
      id: p.id,
      status: p.status,
      amount: p.amount,
      note: p.note,
      createdAt: p.createdAt,
      decidedAt: p.decidedAt,
      challenge: p.challenge.title,
      name: displayNameOf(p.user),
      email: p.user.email,
      telegramId: p.user.telegramId === null ? null : String(p.user.telegramId),
      username: p.user.username,
    }));
  });

  /** Подтвердить перевод: открыть доступ, как после оплаты */
  app.post<{ Params: { id: string } }>("/card-payments/:id/approve", async (req) => {
    const p = await prisma.cardPayment.findUnique({ where: { id: Number(req.params.id) }, include: { user: true, challenge: true } });
    if (!p) throw Object.assign(new Error("Заявка не найдена"), { statusCode: 404 });
    if (p.status === "approved") return { ok: true };
    const res = await grantAccess(p.userId, p.challengeId, "card");
    await prisma.cardPayment.update({ where: { id: p.id }, data: { status: "approved", decidedAt: new Date() } });
    await prisma.payment.create({
      data: {
        userId: p.userId,
        event: "card_transfer",
        dedupKey: `card_transfer:${p.id}`,
        amount: p.amount * 100,
        currency: "rub",
        challengeId: p.challengeId,
        raw: { cardPaymentId: p.id, note: p.note } as Prisma.InputJsonValue,
      },
    }).catch(() => undefined);
    if (res.created) {
      const m = paidMessage(res.startDate, p.user.timezone);
      await notifyUser(p.user, [`Оплата получена: «${esc(p.challenge.title)}».`, ...m.text.split("\n").slice(2)].join("\n"), m.keyboard, {
        subject: `Оплата получена: «${p.challenge.title}»`,
        button: "Открыть челлендж",
        params: { enrollment: String(res.enrollment.id) },
        transactional: true,
      });
    }
    return { ok: true, enrollmentId: res.enrollment.id };
  });

  app.post<{ Params: { id: string } }>("/card-payments/:id/reject", async (req) => {
    const p = await prisma.cardPayment.findUnique({ where: { id: Number(req.params.id) }, include: { user: true, challenge: true } });
    if (!p) throw Object.assign(new Error("Заявка не найдена"), { statusCode: 404 });
    if (p.status !== "pending") throw Object.assign(new Error("Заявка уже обработана"), { statusCode: 400 });
    await prisma.cardPayment.update({ where: { id: p.id }, data: { status: "rejected", decidedAt: new Date() } });
    await notifyUser(p.user, `Мы не нашли ваш перевод за «${esc(p.challenge.title)}». Если вы оплатили, напишите организатору.`, undefined, {
      subject: `Перевод за «${p.challenge.title}» не найден`,
      transactional: true,
    });
    return { ok: true };
  });
}
