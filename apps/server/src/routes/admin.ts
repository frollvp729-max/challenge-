import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/db.js";
import { config } from "../config.js";
import { safeEqual, signAdminToken, verifyAdminToken } from "../lib/telegramAuth.js";
import { localDate } from "../lib/dates.js";
import { challengeLeaderboard, currentDayOf, displayNameOf, grantAccess, recomputeEnrollment } from "../services/enrollments.js";
import { enrollPaidUsers } from "../services/payments.js";
import { imageExt, saveUpload } from "./miniapp.js";

const CHALLENGE_FIELDS = [
  "slug", "title", "tagline", "intro", "rules", "coverUrl", "status", "durationDays", "priceRub", "paymentMode",
  "tributeLink", "tributeSubscriptionId", "tributeProductId", "chatLink", "morningHour", "eveningHour", "startDate",
  "pointsDone", "pointsProof", "pointsViolation", "streakSaveCost", "streakSavesAllowed", "sortOrder",
] as const;
const DAY_FIELDS = ["title", "description", "task", "hint", "imageUrl", "points", "proofType", "proofPrompt", "proofRequired", "checklist"] as const;
const INT_FIELDS = new Set([
  "durationDays", "priceRub", "tributeSubscriptionId", "tributeProductId", "morningHour", "eveningHour",
  "pointsDone", "pointsProof", "pointsViolation", "streakSaveCost", "streakSavesAllowed", "sortOrder", "points",
]);
const NULLABLE = new Set(["startDate", "coverUrl", "tributeLink", "tributeSubscriptionId", "tributeProductId", "chatLink", "imageUrl", "points"]);

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
    else if (f === "proofRequired") v = Boolean(v);
    if (f === "startDate" && v !== null && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) {
      throw Object.assign(new Error("Дата открытия в формате ГГГГ-ММ-ДД"), { statusCode: 400 });
    }
    out[f] = v;
  }
  return out;
}

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
        telegramId: String(e.user.telegramId),
        username: e.user.username,
        name: displayNameOf(e.user),
        registeredAt: e.user.createdAt,
        goal: e.user.goal,
        challenge: e.stream.challenge.title,
        streamStart: e.startDate,
        source: e.source,
        payment: sub ? `${sub.status === "active" ? "активна" : "отменена"} до ${sub.expiresAt.toISOString().slice(0, 10)}` : e.source,
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

  /** Ручная выдача доступа (подарок, тест, оплата мимо Tribute) */
  app.post("/participants", async (req) => {
    const b = req.body as any;
    const tgId = BigInt(String(b?.telegramId ?? "0"));
    const user = await prisma.user.upsert({ where: { telegramId: tgId }, create: { telegramId: tgId }, update: {} });
    if (!b.challengeId) throw Object.assign(new Error("Выбери челлендж"), { statusCode: 400 });
    const res = await grantAccess(user.id, Number(b.challengeId), "admin");
    return res.enrollment;
  });

  app.put<{ Params: { id: string } }>("/participants/:id", async (req) => {
    const status = String((req.body as any)?.status);
    if (!["ACTIVE", "COMPLETED", "CANCELLED"].includes(status)) throw Object.assign(new Error("Неверный статус"), { statusCode: 400 });
    return prisma.enrollment.update({ where: { id: Number(req.params.id) }, data: { status: status as any } });
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
}
