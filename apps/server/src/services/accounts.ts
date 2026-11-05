import type { User } from "@prisma/client";
import { prisma } from "../lib/db.js";

export class AccountConflict extends Error {}

interface TgFrom {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
}

/**
 * Подключить Telegram к аккаунту сайта.
 * Если этот Telegram уже есть в базе отдельным пользователем (открывал бота или оплатил в Tribute),
 * его участия, платежи и сообщения переносятся в аккаунт сайта, а лишняя запись удаляется.
 * Итог: один человек, вход и на сайте (почта и пароль), и в Telegram.
 */
export async function linkTelegram(siteUserId: number, from: TgFrom): Promise<User> {
  const tgId = BigInt(from.id);
  const site = await prisma.user.findUniqueOrThrow({ where: { id: siteUserId } });
  if (site.telegramId !== null && site.telegramId !== tgId) {
    throw new AccountConflict("К этому аккаунту сайта уже подключён другой Telegram");
  }
  const tgUser = await prisma.user.findUnique({ where: { telegramId: tgId } });
  if (tgUser && tgUser.id !== site.id) {
    if (tgUser.email) throw new AccountConflict("Этот Telegram уже подключён к другому аккаунту сайта");
    await mergeUsers(site.id, tgUser.id);
  }
  return prisma.user.update({
    where: { id: site.id },
    data: {
      telegramId: tgId,
      username: from.username ?? tgUser?.username ?? site.username,
      firstName: site.firstName ?? from.first_name ?? tgUser?.firstName,
      lastName: site.lastName ?? from.last_name ?? tgUser?.lastName,
      photoUrl: site.photoUrl ?? tgUser?.photoUrl,
      displayName: site.displayName ?? tgUser?.displayName,
      onboarded: site.onboarded || Boolean(tgUser?.onboarded),
      isOrganizer: site.isOrganizer || Boolean(tgUser?.isOrganizer),
      botBlocked: false,
    },
  });
}

/** Перенести всё от пользователя dropId к keepId и удалить dropId */
export async function mergeUsers(keepId: number, dropId: number) {
  const [keepEnr, dropEnr] = await Promise.all([
    prisma.enrollment.findMany({ where: { userId: keepId } }),
    prisma.enrollment.findMany({ where: { userId: dropId } }),
  ]);
  const clash = dropEnr.find((d) => keepEnr.some((k) => k.streamId === d.streamId && k.startDate === d.startDate));
  if (clash) {
    throw new AccountConflict("В обоих аккаунтах уже идёт один и тот же челлендж с одного дня. Напишите организатору, он объединит их вручную.");
  }
  const keepSubs = await prisma.subscription.findMany({ where: { userId: keepId }, select: { tributeSubscriptionId: true } });
  await prisma.$transaction([
    prisma.enrollment.updateMany({ where: { userId: dropId }, data: { userId: keepId } }),
    prisma.payment.updateMany({ where: { userId: dropId }, data: { userId: keepId } }),
    prisma.cardPayment.updateMany({ where: { userId: dropId }, data: { userId: keepId } }),
    prisma.subscription.deleteMany({ where: { userId: dropId, tributeSubscriptionId: { in: keepSubs.map((s) => s.tributeSubscriptionId) } } }),
    prisma.subscription.updateMany({ where: { userId: dropId }, data: { userId: keepId } }),
    prisma.chatMessage.updateMany({ where: { userId: dropId }, data: { userId: keepId } }),
    // отметки «прочитано» не важны: проще удалить, чем сливать
    prisma.chatRead.deleteMany({ where: { userId: dropId } }),
    prisma.user.delete({ where: { id: dropId } }),
  ]);
}
