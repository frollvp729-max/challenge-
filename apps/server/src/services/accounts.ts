import type { User } from "@prisma/client";
import { prisma } from "../lib/db.js";

export class AccountConflict extends Error {}

export type Platform = "telegram" | "max";

export interface PlatformUser {
  id: number;
  username?: string | null;
  first_name?: string;
  last_name?: string | null;
}

const LABEL: Record<Platform, string> = { telegram: "Telegram", max: "Max" };
const ID_FIELD = { telegram: "telegramId", max: "maxId" } as const;

/**
 * Подключить мессенджер (Telegram или Max) к аккаунту targetId.
 * Если этот мессенджер уже есть в базе отдельным пользователем (открывал бота или оплатил),
 * его участия, платежи и сообщения переносятся, а лишняя запись удаляется.
 * Итог: один человек с общим прогрессом на сайте, в Telegram и в Max.
 */
export async function linkPlatform(targetId: number, platform: Platform, from: PlatformUser): Promise<User> {
  const field = ID_FIELD[platform];
  const otherField = platform === "telegram" ? "maxId" : "telegramId";
  const pid = BigInt(from.id);
  let keep = await prisma.user.findUniqueOrThrow({ where: { id: targetId } });
  if (keep[field] !== null && keep[field] !== pid) {
    throw new AccountConflict(`К этому аккаунту уже подключён другой ${LABEL[platform]}`);
  }
  const found = await prisma.user.findUnique({ where: { [field]: pid } as { telegramId: bigint } });
  let drop: User | null = found && found.id !== keep.id ? found : null;
  if (drop) {
    if (drop.email && keep.email) throw new AccountConflict(`Этот ${LABEL[platform]} уже подключён к другому аккаунту сайта`);
    if (drop[otherField] !== null && keep[otherField] !== null && drop[otherField] !== keep[otherField]) {
      throw new AccountConflict(`Этот ${LABEL[platform]} уже связан с другим аккаунтом`);
    }
    // остаётся аккаунт с почтой (у него вход на сайт), иначе тот, к которому подключаем
    if (drop.email && !keep.email) [keep, drop] = [drop, keep];
    await mergeUsers(keep.id, drop.id);
  }
  const a = keep;
  const b = drop;
  return prisma.user.update({
    where: { id: a.id },
    data: {
      [field]: pid,
      [otherField]: a[otherField] ?? b?.[otherField] ?? null,
      email: a.email ?? b?.email ?? null,
      passwordHash: a.passwordHash ?? b?.passwordHash ?? null,
      username: a.username ?? from.username ?? b?.username,
      firstName: a.firstName ?? from.first_name ?? b?.firstName,
      lastName: a.lastName ?? from.last_name ?? b?.lastName,
      photoUrl: a.photoUrl ?? b?.photoUrl,
      displayName: a.displayName ?? b?.displayName,
      onboarded: a.onboarded || Boolean(b?.onboarded),
      isOrganizer: a.isOrganizer || Boolean(b?.isOrganizer),
      ...(platform === "telegram" ? { botBlocked: false } : { maxBlocked: false }),
    },
  });
}

/** Подключить Telegram к аккаунту сайта (см. linkPlatform) */
export function linkTelegram(siteUserId: number, from: PlatformUser): Promise<User> {
  return linkPlatform(siteUserId, "telegram", from);
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
