/**
 * Сайт без Telegram: регистрация по почте → оплата переводом → подтверждение в админке →
 * подключение Telegram с объединением аккаунтов. Нужен DATABASE_URL, без него тест пропускается.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.BOT_TOKEN = "";
process.env.ADMIN_PASSWORD = "secret";
process.env.DEV_AUTH = "1";

test("сайт: почта и пароль, перевод на карту, подключение Telegram", { skip: !process.env.DATABASE_URL }, async () => {
  const { buildApp } = await import("./app.js");
  const { prisma } = await import("./lib/db.js");
  const { linkTelegram } = await import("./services/accounts.js");
  const app = await buildApp();
  const email = `site${Date.now()}@example.com`;
  const tgId = 910000000 + Math.floor(Math.random() * 1000000);
  try {
    // регистрация и вход
    const reg = await app.inject({ method: "POST", url: "/api/web-auth/register", payload: { email: email.toUpperCase(), password: "secret1", name: "Сайт" } });
    assert.equal(reg.statusCode, 200, reg.body);
    const again = await app.inject({ method: "POST", url: "/api/web-auth/register", payload: { email, password: "secret1", name: "Сайт" } });
    assert.equal(again.statusCode, 409);
    const bad = await app.inject({ method: "POST", url: "/api/web-auth/login", payload: { email, password: "wrong!!" } });
    assert.equal(bad.statusCode, 401);
    const login = await app.inject({ method: "POST", url: "/api/web-auth/login", payload: { email, password: "secret1" } });
    assert.equal(login.statusCode, 200);
    const web = { authorization: `web ${login.json().token}` };
    const me = (await app.inject({ url: "/api/me", headers: web })).json();
    assert.equal(me.user.email, email);
    assert.equal(me.user.telegramId, null);

    // забыли пароль: ответ одинаковый, ссылка из письма задаёт новый пароль один раз
    const forgot = await app.inject({ method: "POST", url: "/api/web-auth/forgot", payload: { email } });
    assert.equal(forgot.statusCode, 200, forgot.body);
    assert.equal(forgot.json().ok, true);
    const unknown = await app.inject({ method: "POST", url: "/api/web-auth/forgot", payload: { email: `x${email}` } });
    assert.equal(unknown.statusCode, 200);
    const { signLinkToken } = await import("./lib/webAuth.js");
    const { config } = await import("./config.js");
    const before = await prisma.user.findUniqueOrThrow({ where: { email } });
    const resetToken = signLinkToken("reset", before.id, config.sessionSecret, before.passwordHash ?? "", 3600);
    const reset = await app.inject({ method: "POST", url: "/api/web-auth/reset", payload: { token: resetToken, password: "newpass1" } });
    assert.equal(reset.statusCode, 200, reset.body);
    const reuse = await app.inject({ method: "POST", url: "/api/web-auth/reset", payload: { token: resetToken, password: "other12" } });
    assert.equal(reuse.statusCode, 400);
    assert.equal((await app.inject({ method: "POST", url: "/api/web-auth/login", payload: { email, password: "secret1" } })).statusCode, 401);
    assert.equal((await app.inject({ method: "POST", url: "/api/web-auth/login", payload: { email, password: "newpass1" } })).statusCode, 200);

    // напоминания на почту: выключить ссылкой из письма и включить в профиле
    const { unsubscribeLink } = await import("./services/notify.js");
    const unsub = await app.inject({ url: unsubscribeLink(before.id).replace(/^https?:\/\/[^/]+/, "") });
    assert.equal(unsub.statusCode, 200);
    assert.equal((await app.inject({ url: "/api/me", headers: web })).json().user.emailReminders, false);
    const on = await app.inject({ method: "POST", url: "/api/account/email-reminders", headers: web, payload: { on: true } });
    assert.equal(on.json().user.emailReminders, true);

    // реквизиты в админке, заявка «Я оплатил», подтверждение
    const adm = { authorization: `Bearer ${(await app.inject({ method: "POST", url: "/admin/api/login", payload: { password: "secret" } })).json().token}` };
    await app.inject({ method: "PUT", url: "/admin/api/card-settings", headers: adm, payload: { number: "2200 0000 0000 0001", holder: "Тест" } });
    const ch = await prisma.challenge.findUniqueOrThrow({ where: { slug: "no-sugar" } });
    let cat = (await app.inject({ url: "/api/challenges", headers: web })).json();
    assert.equal(cat.card.number, "2200 0000 0000 0001");
    assert.equal(cat.hasTelegram, false);
    const req1 = await app.inject({ method: "POST", url: `/api/challenges/${ch.id}/card-payment`, headers: web, payload: { note: "Иван, 1234" } });
    assert.equal(req1.statusCode, 200, req1.body);
    cat = (await app.inject({ url: "/api/challenges", headers: web })).json();
    assert.equal(cat.challenges.find((c: { id: number }) => c.id === ch.id).cardPending, true);
    const list = (await app.inject({ url: "/admin/api/card-payments", headers: adm })).json();
    const mine = list.find((r: { email: string }) => r.email === email);
    assert.equal(mine.status, "pending");
    const ok = await app.inject({ method: "POST", url: `/admin/api/card-payments/${mine.id}/approve`, headers: adm });
    assert.equal(ok.statusCode, 200, ok.body);
    const me2 = (await app.inject({ url: "/api/me", headers: web })).json();
    assert.equal(me2.enrollments.length, 1);

    // этот человек раньше открывал бота: его Telegram-запись сливается с аккаунтом сайта
    const tgUser = await prisma.user.create({ data: { telegramId: BigInt(tgId), username: "tg_twin", isOrganizer: false } });
    const site = await prisma.user.findUniqueOrThrow({ where: { email } });
    const linked = await linkTelegram(site.id, { id: tgId, username: "tg_twin", first_name: "Твин" });
    assert.equal(linked.id, site.id);
    assert.equal(String(linked.telegramId), String(tgId));
    assert.equal(await prisma.user.findUnique({ where: { id: tgUser.id } }), null);
    // теперь тот же аккаунт открывается и из Telegram
    const viaTg = (await app.inject({ url: "/api/me", headers: { "x-dev-user": String(tgId) } })).json();
    assert.equal(viaTg.user.id, site.id);
    assert.equal(viaTg.enrollments.length, 1);
  } finally {
    await prisma.user.deleteMany({ where: { OR: [{ email }, { telegramId: BigInt(tgId) }] } });
    await prisma.setting.deleteMany({ where: { key: { startsWith: "card." } } });
    await app.close();
  }
});
