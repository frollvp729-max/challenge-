import { prisma } from "../lib/db.js";
import { config } from "../config.js";
import { localDate, localHour } from "../lib/dates.js";
import { sendTo } from "../bot/index.js";
import { eveningMessage, finishedMessage, morningMessage, openAppKeyboard } from "../bot/messages.js";
import { currentDayOf, recomputeEnrollment, streamLeaderboard } from "./enrollments.js";

/**
 * Раз в минуту проходит по активным участиям и шлёт утреннее задание,
 * вечернее напоминание и сообщение о завершении. Время — по таймзоне участника.
 * Повторы исключены полями lastMorningDate / lastEveningDate / finishedNotified.
 */
export async function tickNotifications(now = new Date()) {
  const enrollments = await prisma.enrollment.findMany({
    where: { status: "ACTIVE", stream: { challenge: { status: { not: "DRAFT" } } } },
    include: { user: true, stream: { include: { challenge: true } } },
  });

  for (const e of enrollments) {
    const ch = e.stream.challenge;
    const tz = e.user.timezone || config.defaultTimezone;
    const today = localDate(now, tz);
    const hour = localHour(now, tz);
    const day = currentDayOf(e, now);

    try {
      if (day > ch.durationDays) {
        if (!e.finishedNotified) {
          const updated = await recomputeEnrollment(e.id, now);
          const board = await streamLeaderboard(e.streamId);
          const rank = board.find((b) => b.enrollmentId === e.id)?.rank ?? null;
          const m = finishedMessage(ch.title, updated?.doneCount ?? e.doneCount, ch.durationDays, updated?.points ?? e.points, rank);
          await prisma.enrollment.update({ where: { id: e.id }, data: { finishedNotified: true, status: "COMPLETED" } });
          if (!e.user.botBlocked) await sendTo(e.user.telegramId, m.text, m.keyboard);
        }
        continue;
      }
      if (day < 1) continue;

      if (hour >= ch.morningHour && e.lastMorningDate !== today) {
        // пересчёт, чтобы пропуск вчерашнего дня обнулил серию
        const updated = await recomputeEnrollment(e.id, now);
        await prisma.enrollment.update({ where: { id: e.id }, data: { lastMorningDate: today } });
        const task = await prisma.challengeDay.findUnique({
          where: { challengeId_dayNumber: { challengeId: ch.id, dayNumber: day } },
        });
        let missedYesterday = false;
        if (day > 1) {
          const y = await prisma.report.findUnique({
            where: { enrollmentId_dayNumber: { enrollmentId: e.id, dayNumber: day - 1 } },
          });
          missedYesterday = !y && !e.savedDays.includes(day - 1);
        }
        const m = morningMessage({
          day,
          duration: ch.durationDays,
          taskTitle: task?.title ?? `День ${day}`,
          taskText: task?.task ?? "",
          bestStreak: updated?.bestStreak ?? 0,
          currentStreak: updated?.currentStreak ?? 0,
          missedYesterday,
        });
        if (!e.user.botBlocked) await sendTo(e.user.telegramId, m.text, m.keyboard);
        continue;
      }

      if (hour >= ch.eveningHour && e.lastEveningDate !== today && e.lastMorningDate === today) {
        await prisma.enrollment.update({ where: { id: e.id }, data: { lastEveningDate: today } });
        const reported = await prisma.report.count({ where: { enrollmentId: e.id, dayNumber: day } });
        if (!reported && !e.user.botBlocked) {
          const m = eveningMessage(24 - hour, e.currentStreak);
          await sendTo(e.user.telegramId, m.text, m.keyboard);
        }
      }
    } catch (err) {
      console.error(`scheduler: enrollment ${e.id}`, err);
    }
  }
}

/** Рассылки из админки: отправляются по очереди, ~25 сообщений в секунду */
export async function tickBroadcasts() {
  const b = await prisma.broadcast.findFirst({ where: { status: "pending" }, orderBy: { id: "asc" } });
  if (!b) return;
  await prisma.broadcast.update({ where: { id: b.id }, data: { status: "sending" } });
  const where =
    b.audience === "stream" && b.streamId
      ? { enrollments: { some: { streamId: b.streamId } } }
      : b.audience === "challenge" && b.challengeId
        ? { enrollments: { some: { stream: { challengeId: b.challengeId } } } }
        : {};
  const users = await prisma.user.findMany({ where: { ...where, botBlocked: false }, select: { telegramId: true } });
  const kb = b.buttonText ? openAppKeyboard(b.buttonText) : undefined;
  let sent = 0;
  let failed = 0;
  for (const u of users) {
    const ok = await sendTo(u.telegramId, b.text, kb);
    if (ok) sent++;
    else failed++;
    await new Promise((r) => setTimeout(r, 40));
  }
  await prisma.broadcast.update({
    where: { id: b.id },
    data: { status: "done", sentCount: sent, failedCount: failed, finishedAt: new Date() },
  });
}

export function startScheduler() {
  let busy = false;
  const run = async () => {
    if (busy) return;
    busy = true;
    try {
      await tickNotifications();
    } catch (err) {
      console.error("scheduler tick failed", err);
    } finally {
      busy = false;
    }
  };
  let bBusy = false;
  const runB = async () => {
    if (bBusy) return;
    bBusy = true;
    try {
      await tickBroadcasts();
    } catch (err) {
      console.error("broadcast tick failed", err);
    } finally {
      bBusy = false;
    }
  };
  setInterval(run, 60_000);
  setInterval(runB, 10_000);
  void run();
}
