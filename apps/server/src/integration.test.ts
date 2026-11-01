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

  // админ: логин, привязка подписки Tribute к челленджу, дата открытия уже прошла
  const login = await app.inject({ method: "POST", url: "/admin/api/login", payload: { password: "secret" } });
  const token = login.json().token as string;
  const auth = { authorization: `Bearer ${token}` };
  const ch = await prisma.challenge.findUniqueOrThrow({ where: { slug: "no-sugar" } });
  const subId = 700000 + Math.floor(Math.random() * 100000);
  await app.inject({ method: "PUT", url: `/admin/api/challenges/${ch.id}`, headers: auth, payload: { tributeSubscriptionId: subId } });
  const { joinStartDate } = await import("./services/enrollments.js");
  // до даты открытия все начинают в дату открытия
  assert.equal(joinStartDate({ startDate: "2099-11-01" }, "UTC"), "2099-11-01");
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400_000).toISOString().slice(0, 10);
  const badDate = await app.inject({ method: "PUT", url: `/admin/api/challenges/${ch.id}`, headers: auth, payload: { startDate: "1 ноября" } });
  assert.equal(badDate.statusCode, 400);
  await app.inject({ method: "PUT", url: `/admin/api/challenges/${ch.id}`, headers: auth, payload: { startDate: "2020-01-01" } });
  // пользователь в UTC, чтобы «завтра» совпало с датой выше
  await prisma.user.create({ data: { telegramId: BigInt(tgId), timezone: "UTC" } });

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
    const enr = await prisma.enrollment.findFirstOrThrow({ where: { user: { telegramId: BigInt(tgId) } } });
    // пришёл после даты открытия — старт на следующий день после оплаты
    assert.equal(enr.startDate, tomorrow);
    // для проверки отчёта сдвигаем старт на сегодня
    await prisma.enrollment.update({ where: { id: enr.id }, data: { startDate: today } });
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
    assert.equal(lb.me.day, 1);
    assert.equal(lb.sameDay.day, 1);
    assert.equal(lb.sameDay.me.points, 15);

    // продление подписки, пока круг идёт: следующий круг встаёт сразу после текущего
    const renew = body.replace('"new_subscription"', '"renewed_subscription"').replace(/"expires_at":"[^"]+"/, `"expires_at":"${new Date(Date.now() + 60 * 86400_000).toISOString()}"`);
    const rsig = crypto.createHmac("sha256", "test-key").update(renew).digest("hex");
    const rr = await app.inject({ method: "POST", url: "/webhooks/tribute", headers: { "content-type": "application/json", "trbt-signature": rsig }, body: renew });
    assert.equal(rr.json().result.action, "enrolled", rr.body);
    const rounds = await prisma.enrollment.findMany({ where: { user: { telegramId: BigInt(tgId) } }, orderBy: { startDate: "asc" } });
    assert.deepEqual(rounds.map((r) => r.startDate), [today, new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10)]);
    // главным остаётся идущий круг
    const me2 = (await app.inject({ method: "GET", url: "/api/me", headers: h })).json();
    assert.equal(me2.primaryEnrollmentId, me.primaryEnrollmentId);

    const parts = await app.inject({ method: "GET", url: `/admin/api/participants?q=${tgId}`, headers: auth });
    assert.equal(parts.json()[0].points, 15);
  } finally {
    await prisma.challenge.update({ where: { id: ch.id }, data: { tributeSubscriptionId: null, startDate: ch.startDate } });
    await prisma.user.deleteMany({ where: { telegramId: BigInt(tgId) } });
    await prisma.payment.deleteMany({ where: { challengeId: ch.id, raw: { path: ["payload", "telegram_user_id"], equals: tgId } } });
    await app.close();
    await prisma.$disconnect();
  }
});

test("оплата до того, как вписали subscription_id → запись при сохранении челленджа", { skip: !process.env.DATABASE_URL }, async () => {
  const { buildApp } = await import("./app.js");
  const { prisma } = await import("./lib/db.js");
  const app = await buildApp();
  const tgId = 910000000 + Math.floor(Math.random() * 1000000);
  const subId = 800000 + Math.floor(Math.random() * 100000);
  const login = await app.inject({ method: "POST", url: "/admin/api/login", payload: { password: "secret" } });
  const auth = { authorization: `Bearer ${login.json().token}` };
  const ch = await prisma.challenge.findUniqueOrThrow({ where: { slug: "no-sugar" } });
  await prisma.challenge.update({ where: { id: ch.id }, data: { tributeSubscriptionId: null } });
  try {
    const body = JSON.stringify({
      name: "new_subscription",
      payload: {
        subscription_name: "30 дней без сахара",
        subscription_id: subId,
        amount: 49000,
        currency: "rub",
        telegram_user_id: tgId,
        expires_at: new Date(Date.now() + 30 * 86400_000).toISOString(),
      },
    });
    const sig = crypto.createHmac("sha256", "test-key").update(body).digest("hex");
    const res = await app.inject({ method: "POST", url: "/webhooks/tribute", headers: { "content-type": "application/json", "trbt-signature": sig }, body });
    assert.equal(res.json().result.action, "unmapped_subscription");
    assert.equal(await prisma.enrollment.count({ where: { user: { telegramId: BigInt(tgId) } } }), 0);

    const put = await app.inject({ method: "PUT", url: `/admin/api/challenges/${ch.id}`, headers: auth, payload: { tributeSubscriptionId: subId } });
    assert.equal(put.json().enrolled, 1, put.body);
    assert.equal(await prisma.enrollment.count({ where: { user: { telegramId: BigInt(tgId) } } }), 1);
    const pay = await prisma.payment.findFirstOrThrow({ where: { raw: { path: ["payload", "telegram_user_id"], equals: tgId } } });
    assert.equal(pay.challengeId, ch.id);
    // повторное сохранение второй раз не записывает
    const again = await app.inject({ method: "PUT", url: `/admin/api/challenges/${ch.id}`, headers: auth, payload: { tributeSubscriptionId: subId } });
    assert.equal(again.json().enrolled, 0);
  } finally {
    await prisma.challenge.update({ where: { id: ch.id }, data: { tributeSubscriptionId: null } });
    await prisma.payment.deleteMany({ where: { raw: { path: ["payload", "telegram_user_id"], equals: tgId } } });
    await prisma.user.deleteMany({ where: { telegramId: BigInt(tgId) } });
    await app.close();
    await prisma.$disconnect();
  }
});

test("чат челленджа: пишут только участники, у каждого челленджа свой", { skip: !process.env.DATABASE_URL }, async () => {
  const { buildApp } = await import("./app.js");
  const { prisma } = await import("./lib/db.js");
  const { grantAccess } = await import("./services/enrollments.js");
  const app = await buildApp();
  const login = await app.inject({ method: "POST", url: "/admin/api/login", payload: { password: "secret" } });
  const auth = { authorization: `Bearer ${login.json().token}` };
  const base = 930000000 + Math.floor(Math.random() * 1000000);
  const ids = [base, base + 1, base + 2, base + 3];
  const ch = await prisma.challenge.findUniqueOrThrow({ where: { slug: "no-sugar" } });
  const other = await prisma.challenge.findFirstOrThrow({ where: { id: { not: ch.id } }, orderBy: { id: "asc" } });
  const h = (tg: number) => ({ "x-dev-user": String(tg) });
  try {
    const [ua, ub, uc] = await Promise.all(
      ids.slice(0, 3).map((tg, i) =>
        prisma.user.create({ data: { telegramId: BigInt(tg), displayName: ["Аня", "Борис", "Вера"][i], onboarded: true, timezone: "UTC" } }),
      ),
    );
    const ea = (await grantAccess(ua.id, ch.id, "admin")).enrollment.id;
    const eb = (await grantAccess(ub.id, ch.id, "admin")).enrollment.id;
    const ec = (await grantAccess(uc.id, other.id, "admin")).enrollment.id;
    const chat = (e: number) => `/api/enrollments/${e}/chat`;

    const sent = await app.inject({ method: "POST", url: chat(ea), headers: h(ids[0]), payload: { text: "  Всем привет!  " } });
    assert.equal(sent.statusCode, 200, sent.body);
    const msgA = sent.json().message;
    assert.equal(msgA.text, "Всем привет!");
    assert.equal(msgA.author.isMe, true);

    // Борис из того же челленджа видит сообщение
    const seenB = (await app.inject({ method: "GET", url: chat(eb), headers: h(ids[1]) })).json();
    const fromA = seenB.messages.find((m: any) => m.id === msgA.id);
    assert.equal(fromA.text, "Всем привет!");
    assert.equal(fromA.author.isMe, false);
    assert.equal(fromA.author.name, "Аня");
    assert.equal(seenB.members >= 2, true);

    // Вера из другого челленджа его не видит и не может зайти в чужой чат
    const seenC = (await app.inject({ method: "GET", url: chat(ec), headers: h(ids[2]) })).json();
    assert.equal(seenC.messages.some((m: any) => m.id === msgA.id), false);
    assert.equal((await app.inject({ method: "GET", url: chat(ea), headers: h(ids[2]) })).statusCode, 404);
    // человек без оплаты тоже
    assert.equal((await app.inject({ method: "GET", url: chat(ea), headers: h(ids[3]) })).statusCode, 404);
    assert.equal((await app.inject({ method: "POST", url: chat(ea), headers: h(ids[3]), payload: { text: "спам" } })).statusCode, 404);

    // ответ Бориса: у Ани одно непрочитанное
    const reply = await app.inject({ method: "POST", url: chat(eb), headers: h(ids[1]), payload: { text: "Привет, Аня", replyToId: msgA.id } });
    const msgB = reply.json().message;
    assert.equal(msgB.replyTo.name, "Аня");
    let sum = (await app.inject({ method: "GET", url: `${chat(ea)}/summary`, headers: h(ids[0]) })).json();
    assert.equal(sum.unread, 1);
    assert.equal(sum.last.text, "Привет, Аня");
    await app.inject({ method: "POST", url: `${chat(ea)}/read`, headers: h(ids[0]), payload: { lastId: msgB.id } });
    sum = (await app.inject({ method: "GET", url: `${chat(ea)}/summary`, headers: h(ids[0]) })).json();
    assert.equal(sum.unread, 0);

    // чужое сообщение удалить нельзя, своё можно; опрос сообщает об удалении
    assert.equal((await app.inject({ method: "POST", url: `${chat(eb)}/${msgA.id}/delete`, headers: h(ids[1]) })).statusCode, 404);
    assert.equal((await app.inject({ method: "POST", url: `${chat(ea)}/${msgA.id}/delete`, headers: h(ids[0]) })).statusCode, 200);
    const poll = (await app.inject({ method: "GET", url: `${chat(eb)}?after=${msgB.id}&from=${msgA.id}`, headers: h(ids[1]) })).json();
    assert.deepEqual(poll.deletedIds, [msgA.id]);
    assert.deepEqual(poll.messages, []);

    // админ: видит чат, пишет от организатора, ограничивает Бориса
    const adminList = (await app.inject({ method: "GET", url: `/admin/api/chat?challengeId=${ch.id}`, headers: auth })).json();
    assert.equal(adminList.find((m: any) => m.id === msgA.id).text, "Всем привет!");
    const org = await app.inject({ method: "POST", url: "/admin/api/chat", headers: auth, payload: { challengeId: ch.id, text: "Старт завтра!" } });
    assert.equal(org.json().author.organizer, true);
    await app.inject({ method: "POST", url: `/admin/api/chat/users/${ub.id}/ban`, headers: auth, payload: { banned: true } });
    assert.equal((await app.inject({ method: "POST", url: chat(eb), headers: h(ids[1]), payload: { text: "ещё" } })).statusCode, 403);

    // отменённое участие (подписка закончилась) — чат закрыт
    await prisma.enrollment.update({ where: { id: eb }, data: { status: "CANCELLED" } });
    assert.equal((await app.inject({ method: "GET", url: chat(eb), headers: h(ids[1]) })).statusCode, 404);

    // чат можно выключить в админке
    await app.inject({ method: "PUT", url: `/admin/api/challenges/${ch.id}`, headers: auth, payload: { chatEnabled: false } });
    assert.equal((await app.inject({ method: "GET", url: chat(ea), headers: h(ids[0]) })).statusCode, 403);
  } finally {
    await prisma.challenge.update({ where: { id: ch.id }, data: { chatEnabled: true } });
    await prisma.chatMessage.deleteMany({ where: { challengeId: ch.id, userId: null, text: "Старт завтра!" } });
    await prisma.user.deleteMany({ where: { telegramId: { in: ids.map(BigInt) } } });
    await app.close();
    await prisma.$disconnect();
  }
});
