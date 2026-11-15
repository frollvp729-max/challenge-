/**
 * Мессенджер Max: вход в мини-приложение по initData, подключение Max к аккаунту сайта,
 * объединение с Telegram, кнопки бота Max. Нужен DATABASE_URL, без него тест пропускается.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.BOT_TOKEN = "";
process.env.MAX_BOT_TOKEN = "max-test-token";
process.env.MAX_BOT_USERNAME = "test_max_bot";
process.env.ADMIN_PASSWORD = "secret";
process.env.DEV_AUTH = "1";

test("кнопки Telegram превращаются в кнопки Max, экран приложения в startapp", async () => {
  const { InlineKeyboard } = await import("grammy");
  const { toMaxButtons, encodeStartApp, maxAppLink } = await import("./max/bot.js");
  const { openAppKeyboard } = await import("./bot/messages.js");
  assert.equal(encodeStartApp({ screen: "chat", enrollment: "12" }), "chat_e12");
  assert.equal(maxAppLink({ screen: "today" }), "https://max.ru/test_max_bot?startapp=today");
  assert.equal(maxAppLink(), "https://max.ru/test_max_bot?startapp");
  const rows = toMaxButtons(openAppKeyboard("ОТКРЫТЬ ЧАТ", { screen: "chat", enrollment: "7" }));
  assert.deepEqual(rows, [[{ type: "link", text: "ОТКРЫТЬ ЧАТ", url: "https://max.ru/test_max_bot?startapp=chat_e7" }]]);
  const mixed = toMaxButtons(new InlineKeyboard().url("Сайт", "https://example.com").text("Да", "join:1"));
  assert.deepEqual(mixed, [
    [
      { type: "link", text: "Сайт", url: "https://example.com" },
      { type: "callback", text: "Да", payload: "join:1" },
    ],
  ]);
});

test("Max: вход в мини-приложение, подключение к сайту и к Telegram", { skip: !process.env.DATABASE_URL }, async () => {
  const { buildApp } = await import("./app.js");
  const { prisma } = await import("./lib/db.js");
  const { signInitData } = await import("./lib/telegramAuth.js");
  const { linkPlatform } = await import("./services/accounts.js");
  const app = await buildApp();
  const maxId = 820000000 + Math.floor(Math.random() * 1000000);
  const tgId = 930000000 + Math.floor(Math.random() * 1000000);
  const email = `max${Date.now()}@example.com`;
  try {
    // подпись initData Max: тот же алгоритм, что в Telegram, ключ — токен бота Max
    const initData = signInitData(
      { auth_date: String(Math.floor(Date.now() / 1000)), query_id: "q", user: JSON.stringify({ id: maxId, first_name: "Макс" }) },
      "max-test-token",
    );
    const me = await app.inject({ url: "/api/me", headers: { authorization: `max ${initData}` } });
    assert.equal(me.statusCode, 200, me.body);
    assert.equal(me.json().user.max, true);
    assert.equal(me.json().user.telegramId, null);
    assert.equal(me.json().maxBotUsername, "test_max_bot");
    // подпись чужим токеном (например, Telegram) не пускает
    const forged = signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: maxId }) }, "other");
    assert.equal((await app.inject({ url: "/api/me", headers: { authorization: `max ${forged}` } })).statusCode, 401);
    const maxUser = await prisma.user.findUniqueOrThrow({ where: { maxId: BigInt(maxId) } });
    assert.equal(maxUser.lastPlatform, "max");

    // ссылка «подключить Max» для аккаунта сайта
    const reg = await app.inject({ method: "POST", url: "/api/web-auth/register", payload: { email, password: "secret1", name: "Сайт" } });
    const web = { authorization: `web ${reg.json().token}` };
    const link = await app.inject({ method: "POST", url: "/api/account/max-link", headers: web });
    assert.equal(link.statusCode, 200, link.body);
    assert.match(link.json().url, /^https:\/\/max\.ru\/test_max_bot\?start=login_/);
    const platforms = (await app.inject({ url: "/api/web-auth/platforms" })).json();
    assert.equal(platforms.max, "test_max_bot");

    // подтверждение в боте Max: запись Max сливается с аккаунтом сайта
    const site = await prisma.user.findUniqueOrThrow({ where: { email } });
    const linked = await linkPlatform(site.id, "max", { id: maxId, first_name: "Макс" });
    assert.equal(linked.id, site.id);
    assert.equal(String(linked.maxId), String(maxId));
    assert.equal(await prisma.user.findUnique({ where: { id: maxUser.id } }), null);
    const again = (await app.inject({ url: "/api/me", headers: { authorization: `max ${initData}` } })).json();
    assert.equal(again.user.id, site.id);
    assert.equal(again.user.email, email);

    // из Max подключают Telegram, у которого уже была своя запись (оплатил в Tribute)
    const tgUser = await prisma.user.create({ data: { telegramId: BigInt(tgId), username: "tg_pay" } });
    const both = await linkPlatform(site.id, "telegram", { id: tgId, username: "tg_pay" });
    assert.equal(both.id, site.id);
    assert.equal(String(both.telegramId), String(tgId));
    assert.equal(String(both.maxId), String(maxId));
    assert.equal(await prisma.user.findUnique({ where: { id: tgUser.id } }), null);
    const viaTg = (await app.inject({ url: "/api/me", headers: { "x-dev-user": String(tgId) } })).json();
    assert.equal(viaTg.user.id, site.id);
    assert.equal(viaTg.user.max, true);
  } finally {
    await prisma.user.deleteMany({ where: { OR: [{ email }, { telegramId: BigInt(tgId) }, { maxId: BigInt(maxId) }] } });
    await app.close();
  }
});

test("Max без почты подключает Telegram с аккаунтом сайта: остаётся аккаунт с почтой", { skip: !process.env.DATABASE_URL }, async () => {
  const { prisma } = await import("./lib/db.js");
  const { linkPlatform } = await import("./services/accounts.js");
  const maxId = 840000000 + Math.floor(Math.random() * 1000000);
  const tgId = 950000000 + Math.floor(Math.random() * 1000000);
  const email = `tgsite${Date.now()}@example.com`;
  try {
    const maxOnly = await prisma.user.create({ data: { maxId: BigInt(maxId), firstName: "Макс" } });
    const tgSite = await prisma.user.create({ data: { telegramId: BigInt(tgId), email, passwordHash: "x", displayName: "Сайт" } });
    const res = await linkPlatform(maxOnly.id, "telegram", { id: tgId });
    assert.equal(res.id, tgSite.id);
    assert.equal(String(res.maxId), String(maxId));
    assert.equal(res.email, email);
    assert.equal(await prisma.user.findUnique({ where: { id: maxOnly.id } }), null);
  } finally {
    await prisma.user.deleteMany({ where: { OR: [{ email }, { telegramId: BigInt(tgId) }, { maxId: BigInt(maxId) }] } });
  }
});

test("бот Max: /start показывает челлендж, «Участвовать» ведёт на оплату в Telegram", { skip: !process.env.DATABASE_URL }, async () => {
  const http = await import("node:http");
  const sent: Array<{ path: string; query: URLSearchParams; body: any }> = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://x");
      sent.push({ path: url.pathname, query: url.searchParams, body: raw ? JSON.parse(raw) : null });
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ success: true }));
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;
  const { config } = await import("./config.js");
  (config as { maxApiUrl: string }).maxApiUrl = `http://127.0.0.1:${port}`;
  (config as { botUsername: string }).botUsername = "test_tg_bot";
  const { handleMaxUpdate } = await import("./max/bot.js");
  const { prisma } = await import("./lib/db.js");
  const maxId = 860000000 + Math.floor(Math.random() * 1000000);
  const user = { user_id: maxId, first_name: "Макс", name: "Макс" };
  const ch = await prisma.challenge.create({
    data: { slug: `maxtest${maxId}`, title: "Тест Max", status: "ACTIVE", paymentMode: "ONE_TIME", tributeLink: "https://t.me/tribute/app?startapp=pX", sortOrder: -1000 },
  });
  try {
    await handleMaxUpdate({ update_type: "bot_started", timestamp: 0, chat_id: 1, user, payload: `c_${ch.slug}` });
    const intro = sent.at(-1)!;
    assert.equal(intro.path, "/messages");
    assert.equal(intro.query.get("user_id"), String(maxId));
    assert.equal(intro.body.format, "html");
    const buttons = intro.body.attachments[0].payload.buttons.flat();
    assert.equal(buttons[0].type, "callback");
    assert.equal(buttons[0].payload, `join:${ch.id}`);

    await handleMaxUpdate({ update_type: "message_callback", timestamp: 0, callback: { callback_id: "cb1", payload: `join:${ch.id}`, user } });
    assert.ok(sent.some((s) => s.path === "/answers" && s.query.get("callback_id") === "cb1"));
    const offer = sent.at(-1)!;
    assert.match(offer.body.text, /Telegram через Tribute/);
    const pay = offer.body.attachments[0].payload.buttons[0][0];
    assert.equal(pay.type, "link");
    // Telegram ещё не подключён: ссылка сначала подключает его к этому аккаунту
    assert.match(pay.url, /^https:\/\/t\.me\/test_tg_bot\?start=login_/);
    const { afterSlugOf, linkTargetOf } = await import("./lib/webAuth.js");
    const code = pay.url.split("login_")[1];
    const me = await prisma.user.findUniqueOrThrow({ where: { maxId: BigInt(maxId) } });
    assert.equal(linkTargetOf(code), me.id);
    assert.equal(afterSlugOf(code), ch.slug);
  } finally {
    await prisma.user.deleteMany({ where: { maxId: BigInt(maxId) } });
    await prisma.challenge.delete({ where: { id: ch.id } });
    server.close();
  }
});
