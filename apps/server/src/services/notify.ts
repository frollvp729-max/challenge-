import type { User } from "@prisma/client";
import type { InlineKeyboard } from "grammy";
import { config } from "../config.js";
import { sendTo } from "../bot/index.js";
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

/**
 * Сообщение участнику: в Telegram, если он подключён и бот не заблокирован, иначе на почту.
 * transactional: важное письмо (оплата, пароль), уходит даже тем, кто отключил напоминания.
 */
export async function notifyUser(
  user: Pick<User, "id" | "telegramId" | "botBlocked" | "email" | "emailReminders">,
  text: string,
  keyboard: InlineKeyboard | undefined,
  mail: { subject: string; button?: string; params?: Record<string, string>; transactional?: boolean },
): Promise<boolean> {
  if (user.telegramId !== null && !user.botBlocked) {
    const ok = await sendTo(user.telegramId, text, keyboard);
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
