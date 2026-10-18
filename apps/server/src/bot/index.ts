import { Bot, GrammyError, InlineKeyboard, type Api } from "grammy";
import { config } from "../config.js";
import { prisma } from "../lib/db.js";
import { esc, introMessage, openAppKeyboard, paidMessage, priceMessage } from "./messages.js";
import { grantAccess, pickStreamForJoin, primaryEnrollment } from "../services/enrollments.js";

export const bot: Bot | null = config.botToken ? new Bot(config.botToken) : null;

/** Отправка сообщения с учётом блокировки бота пользователем */
export async function sendTo(
  telegramId: bigint | number,
  text: string,
  keyboard?: InlineKeyboard,
): Promise<boolean> {
  if (!bot) {
    console.log(`[bot disabled] → ${telegramId}: ${text.split("\n")[0]}`);
    return true;
  }
  try {
    await bot.api.sendMessage(Number(telegramId), text, {
      parse_mode: "HTML",
      reply_markup: keyboard,
      link_preview_options: { is_disabled: true },
    });
    return true;
  } catch (err) {
    if (err instanceof GrammyError && (err.error_code === 403 || err.error_code === 400)) {
      await prisma.user.updateMany({ where: { telegramId: BigInt(telegramId) }, data: { botBlocked: err.error_code === 403 } });
      return false;
    }
    if (err instanceof GrammyError && err.error_code === 429) {
      const wait = (err.parameters.retry_after ?? 1) * 1000;
      await new Promise((r) => setTimeout(r, wait));
      return sendTo(telegramId, text, keyboard);
    }
    console.error("sendTo failed", err);
    return false;
  }
}

export function botApi(): Api | null {
  return bot?.api ?? null;
}

async function upsertFromCtx(from: { id: number; username?: string; first_name?: string; last_name?: string }) {
  return prisma.user.upsert({
    where: { telegramId: BigInt(from.id) },
    create: { telegramId: BigInt(from.id), username: from.username, firstName: from.first_name, lastName: from.last_name },
    update: { username: from.username, firstName: from.first_name, lastName: from.last_name, botBlocked: false },
  });
}

async function defaultChallenge(slug?: string) {
  if (slug) {
    const bySlug = await prisma.challenge.findFirst({ where: { slug, status: "ACTIVE" } });
    if (bySlug) return bySlug;
  }
  return prisma.challenge.findFirst({ where: { status: "ACTIVE" }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] });
}

export function setupBot() {
  if (!bot) return;

  bot.command("start", async (ctx) => {
    if (!ctx.from) return;
    const user = await upsertFromCtx(ctx.from);
    // /start c_<slug> — диплинк на конкретный челлендж
    const payload = ctx.match?.trim() ?? "";
    const slug = payload.startsWith("c_") ? payload.slice(2) : undefined;
    const enrollment = await primaryEnrollment(user.id);
    if (enrollment && !slug) {
      await ctx.reply(`Ты участвуешь в челлендже «${esc(enrollment.stream.challenge.title)}».`, {
        parse_mode: "HTML",
        reply_markup: openAppKeyboard(),
      });
      return;
    }
    const ch = await defaultChallenge(slug);
    if (!ch) {
      await ctx.reply("Скоро здесь появится новый челлендж. Мы напишем, когда откроется запись.");
      return;
    }
    const m = introMessage(ch);
    if (ch.coverUrl && /^https?:/.test(ch.coverUrl)) {
      await ctx.replyWithPhoto(ch.coverUrl, { caption: m.text, parse_mode: "HTML", reply_markup: m.keyboard }).catch(() =>
        ctx.reply(m.text, { parse_mode: "HTML", reply_markup: m.keyboard }),
      );
    } else {
      await ctx.reply(m.text, { parse_mode: "HTML", reply_markup: m.keyboard });
    }
  });

  bot.callbackQuery(/^join:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const ch = await prisma.challenge.findUnique({ where: { id: Number(ctx.match[1]) } });
    if (!ch || ch.status !== "ACTIVE") {
      await ctx.reply("Запись на этот челлендж закрыта.");
      return;
    }
    const user = await upsertFromCtx(ctx.from);
    const stream = await pickStreamForJoin(ch.id);
    if (ch.paymentMode === "FREE") {
      const res = await grantAccess(user.id, ch.id, "free");
      if (!res) {
        await ctx.reply("Сейчас нет открытого потока. Мы напишем, когда откроется запись.");
        return;
      }
      const m = paidMessage(res.stream, user.timezone);
      await ctx.reply(m.text.replace("Оплата получена.", "Готово!"), { reply_markup: m.keyboard });
      return;
    }
    const m = priceMessage(ch, stream);
    if (!ch.tributeLink) {
      await ctx.reply(m.text + "\n\nОплата скоро откроется.", { parse_mode: "HTML" });
      return;
    }
    await ctx.reply(m.text, { parse_mode: "HTML", reply_markup: m.keyboard });
  });

  bot.command("app", async (ctx) => {
    await ctx.reply("Открыть приложение челленджа:", { reply_markup: openAppKeyboard() });
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(
      "Каждое утро я присылаю задание дня, вечером напоминаю, если отчёта ещё нет.\n\n/app — открыть приложение\n/start — начать",
    );
  });

  bot.catch((err) => console.error("bot error", err.error));
}

export async function startBot() {
  if (!bot) {
    console.warn("BOT_TOKEN не задан: бот выключен, сообщения пишутся в лог.");
    return;
  }
  setupBot();
  await bot.api.setMyCommands([
    { command: "start", description: "Начать" },
    { command: "app", description: "Открыть приложение" },
    { command: "help", description: "Как это работает" },
  ]);
  await bot.api.setChatMenuButton({ menu_button: { type: "web_app", text: "Челлендж", web_app: { url: config.webAppUrl } } });
  // Описание бота (экран до /start) берём из активного челленджа, чтобы не править его в @BotFather
  const ch = await defaultChallenge();
  if (ch) {
    const description = `${ch.title}\n${ch.tagline}\n\nКаждый день — одно задание, отчёт за 30 секунд, рейтинг участников и награды.`;
    await bot.api.setMyDescription(description.slice(0, 512)).catch((err) => console.warn("setMyDescription", err));
    await bot.api.setMyShortDescription(`${ch.title}: ${ch.tagline}`.slice(0, 120)).catch((err) => console.warn("setMyShortDescription", err));
  }
  if (config.botMode === "polling") {
    await bot.api.deleteWebhook();
    bot.start({ onStart: (me) => console.log(`Бот @${me.username} запущен (polling)`) });
  } else if (config.botMode === "webhook") {
    await bot.init();
    await bot.api.setWebhook(`${config.publicUrl}/webhooks/telegram/${config.botWebhookSecret}`, {
      secret_token: config.botWebhookSecret || undefined,
    });
    console.log(`Бот @${bot.botInfo.username} запущен (webhook)`);
  }
}
