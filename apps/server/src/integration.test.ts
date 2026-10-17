/**
 * Сквозной сценарий на живой БД: вебхук Tribute → участие → отчёт → рейтинг.
 * Нужен DATABASE_URL с пустой (или тестовой) базой после seed. Без него тест пропускается.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

process.env.TRIBUTE_API_KEY = "test-key";
process.env.BOT_TOKEN = "";
process.env.ADMIN_PASSWORD = "secret";
process.env.DEV_AUTH = "1";

test("оплата Tribute → челлендж → отчёт", { skip: !process.env.DATABASE_URL }, async () => {
  const { buildApp } = await import("./app.js");
  const { prisma } = await import("./lib/db.js");
  const app = await buildApp();
  const tgId = 900000000 + Math.floor(Math.random() * 1000000);

  // админ: логин, привязка подписки Tribute к челленджу и поток, который уже идёт
  const login = await app.inject({ method: "POST", url: "/admin/api/login", payload: { password: "secret" } });
  const token = login.json().token as string;
  const auth = { authorization: `Bearer ${token}` };
  const ch = await prisma.challenge.findUniqueOrThrow({ where: { slug: "no-sugar" } });
  const subId = 700000 + Math.floor(Math.random() * 100000);
  await app.inject({ method: "PUT", url: `/admin/api/challenges/${ch.id}`, headers: auth, payload: { tributeSubscriptionId: subId } });
  const today = new Date().toISOString().slice(0, 10);
  const st = await app.inject({ method: "POST", url: `/admin/api/challenges/${ch.id}/streams`, headers: auth, payload: { startDate: today, title: "test" } });
  assert.equal(st.statusCode, 200);
  // закрываем будущие потоки на время теста, чтобы запись пошла в сегодняшний
  const others = await prisma.stream.findMany({ where: { challengeId: ch.id, enrollmentOpen: true, id: { not: st.json().id } } });
  await prisma.stream.updateMany({ where: { id: { in: others.map((o) => o.id) } }, data: { enrollmentOpen: false } });

  try {
    const body = JSON.stringify({
      name: "new_subscription",
      created_at: new Date().toISOString(),
      sent_at: new Date().toISOString(),
      payload: {
        subscription_name: "30 дней без сахара",
        subscription_id: subId,
        period_id: 1,
        period: "monthly",
        type: "regular",
        price: 49000,
        amount: 49000,
        currency: "rub",
        trb_user_id: "T-1",
        telegram_user_id: tgId,
        telegram_username: "tester",
        channel_id: 1,
        channel_name: "x",
        expires_at: new Date(Date.now() + 30 * 86400_000).toISOString(),
      },
    });
    const bad = await app.inject({ method: "POST", url: "/webhooks/tribute", headers: { "content-type": "application/json", "trbt-signature": "nope" }, body });
    assert.equal(bad.statusCode, 401);
    const sig = crypto.createHmac("sha256", "test-key").update(body).digest("hex");
    const ok = await app.inject({ method: "POST", url: "/webhooks/tribute", headers: { "content-type": "application/json", "trbt-signature": sig }, body });
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.json().result.action, "enrolled");
    const dup = await app.inject({ method: "POST", url: "/webhooks/tribute", headers: { "content-type": "application/json", "trbt-signature": sig }, body });
    assert.equal(dup.json().result.action, "duplicate");

    const h = { "x-dev-user": String(tgId) };
    // таймзона UTC, чтобы «сегодня» совпало с датой старта
    await app.inject({ method: "POST", url: "/api/timezone", headers: h, payload: { timezone: "UTC" } });
    const me = (await app.inject({ method: "GET", url: "/api/me", headers: h })).json();
    assert.ok(me.primaryEnrollmentId);
    const prof = await app.inject({ method: "POST", url: "/api/profile", headers: h, payload: { displayName: "Тестер", goal: "habit", timezone: "UTC" } });
    assert.equal(prof.statusCode, 200);

    let state = (await app.inject({ method: "GET", url: `/api/enrollments/${me.primaryEnrollmentId}`, headers: h })).json();
    assert.equal(state.day, 1);
    assert.equal(state.phase, "running");
    assert.equal(state.todayTask.title, "Убери добавленный сахар");

    const r1 = await app.inject({ method: "POST", url: `/api/enrollments/${me.primaryEnrollmentId}/report`, headers: h, payload: { status: "DONE" } });
    assert.equal(r1.statusCode, 200, r1.body);
    state = r1.json();
    assert.equal(state.score.points, 10);
    state = (await app.inject({ method: "POST", url: `/api/enrollments/${me.primaryEnrollmentId}/report`, headers: h, payload: { proofText: "Не купил шоколадку" } })).json();
    assert.equal(state.score.points, 15);
    assert.equal(state.score.currentStreak, 1);
    assert.equal(state.rank, 1);

    const lb = (await app.inject({ method: "GET", url: `/api/enrollments/${me.primaryEnrollmentId}/leaderboard`, headers: h })).json();
    assert.equal(lb.me.name, "Тестер");

    const parts = await app.inject({ method: "GET", url: `/admin/api/participants?q=${tgId}`, headers: auth });
    assert.equal(parts.json()[0].points, 15);
  } finally {
    await prisma.stream.updateMany({ where: { id: { in: others.map((o) => o.id) } }, data: { enrollmentOpen: true } });
    await prisma.stream.delete({ where: { id: st.json().id } });
    await prisma.challenge.update({ where: { id: ch.id }, data: { tributeSubscriptionId: null } });
    await prisma.user.deleteMany({ where: { telegramId: BigInt(tgId) } });
    await prisma.payment.deleteMany({ where: { challengeId: ch.id, raw: { path: ["payload", "telegram_user_id"], equals: tgId } } });
    await app.close();
    await prisma.$disconnect();
  }
});
