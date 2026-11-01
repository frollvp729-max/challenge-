import type { ChatMessage, User } from "@prisma/client";
import { prisma } from "../lib/db.js";
import { currentDayOf, displayNameOf } from "./enrollments.js";

/** Кто считается участником чата: оплаченное или пройденное участие в челлендже */
export const CHAT_MEMBER_STATUSES = ["ACTIVE", "COMPLETED"] as const;
export const CHAT_TEXT_MAX = 1000;
export const CHAT_PAGE = 50;
export const ORGANIZER_NAME = "Организатор";

type MessageWithRelations = ChatMessage & {
  user: User | null;
  replyTo: (ChatMessage & { user: User | null }) | null;
};

const include = { user: true, replyTo: { include: { user: true } } } as const;

function snippet(m: Pick<ChatMessage, "text" | "photoUrl" | "deleted">) {
  if (m.deleted) return "Сообщение удалено";
  const t = m.text.replace(/\s+/g, " ").trim();
  if (t) return t.length > 90 ? `${t.slice(0, 90)}…` : t;
  return m.photoUrl ? "Фото" : "";
}

const authorName = (u: User | null) => (u ? displayNameOf(u) : ORGANIZER_NAME);

/** Подпись под именем: на каком дне своих 30 дней сейчас автор */
async function authorDays(challengeId: number, userIds: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (!userIds.length) return out;
  const list = await prisma.enrollment.findMany({
    where: { userId: { in: userIds }, stream: { challengeId }, status: { in: [...CHAT_MEMBER_STATUSES] } },
    include: { user: true, stream: { include: { challenge: true } } },
    orderBy: { startDate: "asc" },
  });
  for (const e of list) {
    const day = currentDayOf(e);
    const dur = e.stream.challenge.durationDays;
    // у повторного круга дата старта позже, он перезапишет подпись
    out.set(e.userId, day < 1 ? "скоро старт" : day > dur ? `прошёл ${dur} дней` : `день ${day}`);
  }
  return out;
}

export async function serializeMessages(challengeId: number, list: MessageWithRelations[], viewerId: number | null) {
  const ids = [...new Set(list.map((m) => m.userId).filter((x): x is number => x !== null))];
  const days = await authorDays(challengeId, ids);
  return list.map((m) => ({
    id: m.id,
    text: m.deleted ? "" : m.text,
    photoUrl: m.deleted ? null : m.photoUrl,
    deleted: m.deleted,
    createdAt: m.createdAt.toISOString(),
    author: {
      userId: m.userId,
      name: authorName(m.user),
      photoUrl: m.user?.photoUrl ?? null,
      organizer: m.userId === null,
      isMe: viewerId !== null && m.userId === viewerId,
      badge: m.userId === null ? null : m.user?.isOrganizer ? "организатор" : days.get(m.userId) ?? null,
      banned: m.user?.chatBanned ?? false,
    },
    replyTo: m.replyTo ? { id: m.replyTo.id, name: authorName(m.replyTo.user), text: snippet(m.replyTo) } : null,
  }));
}

/**
 * Страница сообщений:
 * - без параметров — последние CHAT_PAGE;
 * - after — новые после id (для опроса);
 * - before — более старые (листание вверх).
 */
export async function loadMessages(challengeId: number, opts: { after?: number; before?: number }) {
  if (opts.after) {
    return prisma.chatMessage.findMany({
      where: { challengeId, id: { gt: opts.after } },
      include,
      orderBy: { id: "asc" },
      take: 200,
    });
  }
  const list = await prisma.chatMessage.findMany({
    where: { challengeId, ...(opts.before ? { id: { lt: opts.before } } : {}) },
    include,
    orderBy: { id: "desc" },
    take: CHAT_PAGE,
  });
  return list.reverse();
}

export async function chatMembersCount(challengeId: number) {
  const rows = await prisma.enrollment.findMany({
    where: { stream: { challengeId }, status: { in: [...CHAT_MEMBER_STATUSES] } },
    select: { userId: true },
    distinct: ["userId"],
  });
  return rows.length;
}

export async function markRead(userId: number, challengeId: number, lastId: number) {
  const cur = await prisma.chatRead.findUnique({ where: { userId_challengeId: { userId, challengeId } } });
  if (cur && cur.lastReadId >= lastId) return;
  await prisma.chatRead.upsert({
    where: { userId_challengeId: { userId, challengeId } },
    create: { userId, challengeId, lastReadId: lastId },
    update: { lastReadId: lastId },
  });
}

/** Для карточки на главной: сколько непрочитанных и последнее сообщение */
export async function chatSummary(userId: number, challengeId: number) {
  const read = await prisma.chatRead.findUnique({ where: { userId_challengeId: { userId, challengeId } } });
  const lastReadId = read?.lastReadId ?? 0;
  const [unread, last, members] = await Promise.all([
    prisma.chatMessage.count({
      where: { challengeId, id: { gt: lastReadId }, deleted: false, NOT: { userId } },
    }),
    prisma.chatMessage.findFirst({ where: { challengeId, deleted: false }, include: { user: true }, orderBy: { id: "desc" } }),
    chatMembersCount(challengeId),
  ]);
  return {
    unread,
    members,
    last: last
      ? { name: last.userId === userId ? "Вы" : authorName(last.user), text: snippet(last), createdAt: last.createdAt.toISOString() }
      : null,
  };
}

/** Простое ограничение частоты: не больше 6 сообщений за 30 секунд от одного человека */
const recent = new Map<number, number[]>();
export function rateLimited(userId: number, now = Date.now()) {
  const list = (recent.get(userId) ?? []).filter((t) => now - t < 30_000);
  if (list.length >= 6) {
    recent.set(userId, list);
    return true;
  }
  list.push(now);
  recent.set(userId, list);
  return false;
}

/** Уведомление в бота «вам ответили»: не чаще раза в 5 минут на человека */
const lastNotified = new Map<number, number>();
export function shouldNotify(userId: number, now = Date.now()) {
  const prev = lastNotified.get(userId) ?? 0;
  if (now - prev < 5 * 60_000) return false;
  lastNotified.set(userId, now);
  return true;
}

export { snippet as chatSnippet, include as chatInclude };
