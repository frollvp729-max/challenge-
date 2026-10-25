import { Prisma } from "@prisma/client";
import { prisma } from "../lib/db.js";
import type { TributeDigitalProductPayload, TributeEvent, TributeSubscriptionPayload } from "../lib/tribute.js";
import { grantAccess } from "./enrollments.js";
import { sendTo } from "../bot/index.js";
import { esc, openAppKeyboard, paidMessage } from "../bot/messages.js";
import { humanDate } from "../lib/dates.js";

async function upsertUser(telegramId: number, username?: string) {
  return prisma.user.upsert({
    where: { telegramId: BigInt(telegramId) },
    create: { telegramId: BigInt(telegramId), username },
    update: username ? { username } : {},
  });
}

/** Записать событие в журнал. false — такое событие уже обрабатывали (повтор вебхука). */
async function logPayment(data: Prisma.PaymentUncheckedCreateInput): Promise<boolean> {
  try {
    await prisma.payment.create({ data });
    return true;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return false;
    throw err;
  }
}

export type HandleResult = { ok: true; action: string } | { ok: false; reason: string };

export async function handleTributeEvent(ev: TributeEvent): Promise<HandleResult> {
  switch (ev.name) {
    case "new_subscription":
    case "renewed_subscription":
      return onSubscriptionPaid(ev.name, ev.payload as TributeSubscriptionPayload, ev);
    case "cancelled_subscription":
      return onSubscriptionCancelled(ev.payload as TributeSubscriptionPayload, ev);
    case "new_digital_product":
      return onDigitalProduct(ev.payload as TributeDigitalProductPayload, ev);
    default:
      return { ok: true, action: "ignored" };
  }
}

async function onSubscriptionPaid(name: string, p: TributeSubscriptionPayload, raw: TributeEvent): Promise<HandleResult> {
  const user = await upsertUser(p.telegram_user_id, p.telegram_username);
  const challenge = await prisma.challenge.findUnique({ where: { tributeSubscriptionId: p.subscription_id } });
  const fresh = await logPayment({
    userId: user.id,
    event: name,
    dedupKey: `${name}:${p.subscription_id}:${p.telegram_user_id}:${p.expires_at}`,
    amount: p.amount ?? p.price,
    currency: p.currency,
    challengeId: challenge?.id,
    raw: raw as unknown as Prisma.InputJsonValue,
  });
  if (!fresh) {
    // Повтор вебхука. Если в прошлый раз доступ не выдался (ошибка на середине), выдать сейчас.
    if (challenge) await grantAccess(user.id, challenge.id, "tribute_subscription");
    return { ok: true, action: "duplicate" };
  }

  await prisma.subscription.upsert({
    where: { userId_tributeSubscriptionId: { userId: user.id, tributeSubscriptionId: p.subscription_id } },
    create: {
      userId: user.id,
      tributeSubscriptionId: p.subscription_id,
      periodId: p.period_id,
      period: p.period,
      expiresAt: new Date(p.expires_at),
    },
    update: { status: "active", expiresAt: new Date(p.expires_at), periodId: p.period_id, period: p.period, cancelReason: null },
  });

  if (!challenge) {
    console.warn(`Tribute: подписка ${p.subscription_id} не привязана ни к одному челленджу`);
    return { ok: true, action: "unmapped_subscription" };
  }

  const res = await grantAccess(user.id, challenge.id, "tribute_subscription", new Date(), {
    renewal: name === "renewed_subscription",
  });
  if (res.created) {
    const m = paidMessage(res.startDate, user.timezone);
    if (name === "renewed_subscription") {
      m.text = `Подписка продлена. Следующие 30 дней «${esc(challenge.title)}» начнутся ${humanDate(res.startDate)}.`;
    }
    await sendTo(user.telegramId, m.text, m.keyboard);
    return { ok: true, action: "enrolled" };
  }
  if (name === "new_subscription") {
    const m = paidMessage(res.startDate, user.timezone);
    await sendTo(user.telegramId, m.text, m.keyboard);
  }
  return { ok: true, action: "extended" };
}

async function onSubscriptionCancelled(p: TributeSubscriptionPayload, raw: TributeEvent): Promise<HandleResult> {
  const user = await upsertUser(p.telegram_user_id, p.telegram_username);
  const challenge = await prisma.challenge.findUnique({ where: { tributeSubscriptionId: p.subscription_id } });
  const fresh = await logPayment({
    userId: user.id,
    event: "cancelled_subscription",
    dedupKey: `cancelled_subscription:${p.subscription_id}:${p.telegram_user_id}:${p.expires_at}`,
    challengeId: challenge?.id,
    raw: raw as unknown as Prisma.InputJsonValue,
  });
  if (!fresh) return { ok: true, action: "duplicate" };
  await prisma.subscription.updateMany({
    where: { userId: user.id, tributeSubscriptionId: p.subscription_id },
    data: { status: "cancelled", cancelReason: p.cancel_reason || null, expiresAt: new Date(p.expires_at) },
  });
  // Оплаченный круг остаётся доступным до конца: отключено только автопродление.
  if (challenge) {
    await sendTo(
      user.telegramId,
      `Автопродление подписки «${esc(challenge.title)}» отключено. Текущий челлендж остаётся доступным до конца.`,
      openAppKeyboard(),
    );
  }
  return { ok: true, action: "cancelled" };
}

async function onDigitalProduct(p: TributeDigitalProductPayload, raw: TributeEvent): Promise<HandleResult> {
  if (!p.telegram_user_id) return { ok: false, reason: "no telegram_user_id" };
  const user = await upsertUser(p.telegram_user_id, p.telegram_username);
  const challenge = await prisma.challenge.findUnique({ where: { tributeProductId: p.product_id } });
  const fresh = await logPayment({
    userId: user.id,
    event: "new_digital_product",
    dedupKey: `new_digital_product:${p.purchase_id}`,
    amount: p.amount,
    currency: p.currency,
    challengeId: challenge?.id,
    raw: raw as unknown as Prisma.InputJsonValue,
  });
  if (!fresh) {
    if (challenge) await grantAccess(user.id, challenge.id, "tribute_product");
    return { ok: true, action: "duplicate" };
  }
  if (!challenge) {
    console.warn(`Tribute: товар ${p.product_id} не привязан ни к одному челленджу`);
    return { ok: true, action: "unmapped_product" };
  }
  const res = await grantAccess(user.id, challenge.id, "tribute_product");
  const m = paidMessage(res.startDate, user.timezone);
  await sendTo(user.telegramId, m.text, m.keyboard);
  return { ok: true, action: res.created ? "enrolled" : "already_enrolled" };
}

/** Привязать к челленджу платежи, пришедшие до того, как в нём указали subscription_id / product_id */
export async function linkPayments(challengeId: number) {
  const ch = await prisma.challenge.findUniqueOrThrow({ where: { id: challengeId } });
  const keys: Array<[string, number]> = [];
  if (ch.tributeSubscriptionId) keys.push(["subscription_id", ch.tributeSubscriptionId]);
  if (ch.tributeProductId) keys.push(["product_id", ch.tributeProductId]);
  let linked = 0;
  for (const [key, value] of keys) {
    const r = await prisma.payment.updateMany({
      where: { challengeId: null, raw: { path: ["payload", key], equals: value } },
      data: { challengeId },
    });
    linked += r.count;
  }
  return { linked };
}

/**
 * Записать всех, у кого есть активная оплата челленджа, но нет идущего или будущего круга.
 * Нужна, когда оплата пришла до того, как подписку привязали к челленджу.
 */
export async function enrollPaidUsers(challengeId: number) {
  await linkPayments(challengeId);
  const ch = await prisma.challenge.findUniqueOrThrow({ where: { id: challengeId } });
  const userIds = new Set<number>();
  if (ch.tributeSubscriptionId) {
    const subs = await prisma.subscription.findMany({
      where: { tributeSubscriptionId: ch.tributeSubscriptionId, expiresAt: { gt: new Date() } },
    });
    subs.forEach((s) => userIds.add(s.userId));
  }
  const paidNoStream = await prisma.payment.findMany({
    where: { challengeId, event: { in: ["new_digital_product", "new_subscription", "renewed_subscription"] }, userId: { not: null } },
    select: { userId: true },
  });
  // разовые покупки без участия
  for (const p of paidNoStream) {
    const has = await prisma.enrollment.count({ where: { userId: p.userId!, stream: { challengeId } } });
    if (!has) userIds.add(p.userId!);
  }
  let enrolled = 0;
  for (const userId of userIds) {
    const res = await grantAccess(userId, challengeId, "tribute_subscription");
    if (res?.created) {
      enrolled++;
      const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      const m = paidMessage(res.startDate, user.timezone);
      await sendTo(user.telegramId, `Ты записан в челлендж «${esc(ch.title)}».\n` + m.text.split("\n").slice(2).join("\n"), m.keyboard);
    }
  }
  return { enrolled };
}
