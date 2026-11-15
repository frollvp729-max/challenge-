import type { User } from "@prisma/client";
import type { InlineKeyboard } from "grammy";
import { config } from "../config.js";
import { sendTo } from "../bot/index.js";
import { sendToMax } from "../max/bot.js";
import { sendMail } from "../lib/mail.js";
import { signLinkToken } from "../lib/webAuth.js";

/** Ссылка на нужный экран приложения на сайте */
export function appLink(params: Record<string, string> = {}) {
  const q = new URLSearchParams(params).toString();
  return `${config.webAppUrl}${q ? `?${q}` : ""}`;
}

/** Ссылка «отписаться от писем» (действует год) */
export function unsubscribeLink(userId: number) {
  const token = signLinkToken("unsub", userId, config.sessionSecret, "", 365 * 24 * 3600);
  return `${config.publicUrl}/api/web-auth/unsubscribe?token=${encodeURIComponent(token)}`;
}

type Recipient = Pick<User, "id" | "telegramId" | "botBlocked" | "maxId" | "maxBlocked" | "lastPlatform">;

/**
 * Сообщение в мессенджер: туда, где человек занимался последним (Telegram или Max),
 * если там не дошло, во второй. Одно сообщение, без дублей.
 */
export async function notifyMessenger(user: Recipient, text: string, keyboard?: InlineKeyboard): Promise<boolean> {
  const tg = async () => user.telegramId !== null && !user.botBlocked && sendTo(user.telegramId, text, keyboard);
  const max = async () => user.maxId !== null && !user.maxBlocked && sendToMax(user.maxId, text, keyboard);
  const order = user.lastPlatform === "max" ? [max, tg] : [tg, max];
  for (const send of order) if (await send()) return true;
  return false;
}

/**
 * Сообщение участнику: в мессенджер (Telegram или Max), а если их нет или бот недоступен, на почту.
 * transactional: важное письмо (оплата, пароль), уходит даже тем, кто отключил напоминания.
 */
export async function notifyUser(
  user: Recipient & Pick<User, "email" | "emailReminders">,
  text: string,
  keyboard: InlineKeyboard | undefined,
  mail: { subject: string; button?: string; params?: Record<string, string>; transactional?: boolean },
): Promise<boolean> {
  const hasMessenger = (user.telegramId !== null && !user.botBlocked) || (user.maxId !== null && !user.maxBlocked);
  if (hasMessenger) {
    const ok = await notifyMessenger(user, text, keyboard);
    if (ok || !user.email) return ok;
  }
  if (!user.email || (!mail.transactional && !user.emailReminders)) return false;
  return sendMail({
    to: user.email,
    subject: mail.subject,
    text,
    button: mail.button ? { text: mail.button, url: appLink(mail.params) } : undefined,
    footer: mail.transactional
      ? undefined
      : `Это напоминание о вашем челлендже. <a href="${unsubscribeLink(user.id)}" style="color:#5a6377">Не присылать напоминания на почту</a>`,
  });
}
