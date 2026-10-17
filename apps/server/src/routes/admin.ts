import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/db.js";
import { config } from "../config.js";
import { safeEqual, signAdminToken, verifyAdminToken } from "../lib/telegramAuth.js";
import { dayNumber, localDate } from "../lib/dates.js";
import { displayNameOf, grantAccess, recomputeEnrollment, streamLeaderboard, streamPhase } from "../services/enrollments.js";
import { enrollPaidUsers } from "../services/payments.js";
import { imageExt, saveUpload } from "./miniapp.js";

const CHALLENGE_FIELDS = [
  "slug", "title", "tagline", "intro", "rules", "coverUrl", "status", "durationDays", "priceRub", "paymentMode",
  "tributeLink", "tributeSubscriptionId", "tributeProductId", "chatLink", "morningHour", "eveningHour",
  "pointsDone", "pointsProof", "pointsViolation", "streakSaveCost", "streakSavesAllowed", "sortOrder",
] as const;
const DAY_FIELDS = ["title", "description", "task", "hint", "imageUrl", "points", "proofType", "proofPrompt", "proofRequired", "checklist"] as const;
const INT_FIELDS = new Set([
  "durationDays", "priceRub", "tributeSubscriptionId", "tributeProductId", "morningHour", "eveningHour",
  "pointsDone", "pointsProof", "pointsViolation", "streakSaveCost", "streakSavesAllowed", "sortOrder", "points",
]);
const NULLABLE = new Set(["coverUrl", "tributeLink", "tributeSubscriptionId", "tributeProductId", "chatLink", "imageUrl", "points"]);

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
      prisma.challenge.findMany({ include: { streams: { include: { _count: { select: { enrollments: true } } } } } }),
    ]);
    const revenue = payments.filter((p) => !p.currency || p.currency.toLowerCase() === "rub").reduce((s, p) => s + (p.amount ?? 0), 0);
    const streams = [];
    for (const ch of challenges) {
      for (const s of ch.streams) {
        const phase = streamPhase(s, ch.durationDays);
        const day = dayNumber(s.startDate, new Date(), config.defaultTimezone);
        let reportedToday = 0;
        if (phase === "RUNNING") {
          reportedToday = await prisma.report.count({ where: { dayNumber: day, enrollment: { streamId: s.id } } });
        }
        streams.push({
          id: s.id,
          challenge: ch.title,
          startDate: s.startDate,
          phase,
          day,
          participants: s._count.enrollments,
          reportedToday,
        });
      }
    }
    return {
      today,
      users,
      enrollments,
      paymentsCount: payments.length,
      revenue,
      newUsers7d: await prisma.user.count({ where: { createdAt: { gt: new Date(Date.now() - 7 * 86400_000) } } }),
      streams,
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
      streams: c.streams.map((s) => ({ ...s, phase: streamPhase(s, c.durationDays), participants: s._count.enrollments })),
    }));
  });

  app.get<{ Params: { id: string } }>("/challenges/:id", async (req) => {
    const c = await prisma.challenge.findUniqueOrThrow({
      where: { id: Number(req.params.id) },
      include: {
        days: { orderBy: { dayNumber: "asc" } },
        streams: { orderBy: { startDate: "desc" }, include: { _count: { select: { enrollments: true } } } },
      },
    });
    return { ...c, streams: c.streams.map((s) => ({ ...s, phase: streamPhase(s, c.durationDays), participants: s._count.enrollments })) };
  });

  app.post("/challenges", async (req) => {
    const data = pick(req.body, CHALLENGE_FIELDS) as Prisma.ChallengeCreateInput;
    if (!data.title || !data.slug) throw Object.assign(new Error("Нужны название и slug"), { statusCode: 400 });
    return prisma.challenge.create({ data });
  });

  app.put<{ Params: { id: string } }>("/challenges/:id", async (req) => {
    const data = pick(req.body, CHALLENGE_FIELDS);
    return prisma.challenge.update({ where: { id: Number(req.params.id) }, data });
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

  // ---------- Потоки ----------
  app.post<{ Params: { id: string } }>("/challenges/:id/streams", async (req) => {
    const b = req.body as any;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b?.startDate))) throw Object.assign(new Error("Дата старта в формате ГГГГ-ММ-ДД"), { statusCode: 400 });
    return prisma.stream.create({
      data: { challengeId: Number(req.params.id), startDate: b.startDate, title: b.title ?? "", enrollmentOpen: b.enrollmentOpen ?? true },
    });
  });

  app.put<{ Params: { id: string } }>("/streams/:id", async (req) => {
    const b = req.body as any;
    const data: Prisma.StreamUpdateInput = {};
    if (b.title !== undefined) data.title = String(b.title);
    if (b.enrollmentOpen !== undefined) data.enrollmentOpen = Boolean(b.enrollmentOpen);
    if (b.startDate !== undefined) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.startDate))) throw Object.assign(new Error("Дата в формате ГГГГ-ММ-ДД"), { statusCode: 400 });
      data.startDate = b.startDate;
    }
    return prisma.stream.update({ where: { id: Number(req.params.id) }, data });
  });

  app.post<{ Params: { id: string } }>("/challenges/:id/enroll-paid", async (req) => enrollPaidUsers(Number(req.params.id)));

  app.get<{ Params: { id: string } }>("/streams/:id/leaderboard", async (req) => streamLeaderboard(Number(req.params.id)));

  // ---------- Участники ----------
  app.get<{ Querystring: { q?: string; challengeId?: string; streamId?: string } }>("/participants", async (req) => {
    const { q, challengeId, streamId } = req.query;
    const where: Prisma.EnrollmentWhereInput = {};
    if (streamId) where.streamId = Number(streamId);
    else if (challengeId) where.stream = { challengeId: Number(challengeId) };
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
      if (!boards.has(e.streamId)) {
        boards.set(e.streamId, new Map((await streamLeaderboard(e.streamId)).map((r) => [r.enrollmentId, r.rank])));
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
        streamStart: e.stream.startDate,
        source: e.source,
        payment: sub ? `${sub.status === "active" ? "активна" : "отменена"} до ${sub.expiresAt.toISOString().slice(0, 10)}` : e.source,
        day: dayNumber(e.stream.startDate, new Date(), e.user.timezone),
        currentStreak: e.currentStreak,
        bestStreak: e.bestStreak,
        points: e.points,
        doneCount: e.doneCount,
        rank: boards.get(e.streamId)!.get(e.id) ?? null,
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
    if (b.streamId) {
      return prisma.enrollment.upsert({
        where: { userId_streamId: { userId: user.id, streamId: Number(b.streamId) } },
        create: { userId: user.id, streamId: Number(b.streamId), source: "admin" },
        update: { status: "ACTIVE" },
      });
    }
    const res = await grantAccess(user.id, Number(b.challengeId), "admin");
    if (!res) throw Object.assign(new Error("Нет открытого потока"), { statusCode: 400 });
    return res.enrollment;
  });

  app.put<{ Params: { id: string } }>("/participants/:id", async (req) => {
    const status = String((req.body as any)?.status);
    if (!["ACTIVE", "COMPLETED", "CANCELLED"].includes(status)) throw Object.assign(new Error("Неверный статус"), { statusCode: 400 });
    return prisma.enrollment.update({ where: { id: Number(req.params.id) }, data: { status: status as any } });
  });

  // ---------- Результаты (отчёты) ----------
  app.get<{ Querystring: { streamId?: string; day?: string; withProof?: string } }>("/reports", async (req) => {
    const where: Prisma.ReportWhereInput = {};
    if (req.query.streamId) where.enrollment = { streamId: Number(req.query.streamId) };
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
