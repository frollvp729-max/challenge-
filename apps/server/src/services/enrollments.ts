import type { Challenge, ChallengeDay, Enrollment, Report, Stream, User } from "@prisma/client";
import { prisma } from "../lib/db.js";
import { config } from "../config.js";
import { dayNumber, localDate, zonedMidnight } from "../lib/dates.js";
import { computeScore, earnedRewards, REWARDS, type ScoreResult, type ScoringRules } from "../lib/scoring.js";

export type EnrollmentFull = Enrollment & {
  user: User;
  stream: Stream & { challenge: Challenge };
};

export function rulesOf(challenge: Challenge, days?: Pick<ChallengeDay, "dayNumber" | "points">[]): ScoringRules {
  const dayPoints: Record<number, number | null> = {};
  for (const d of days ?? []) dayPoints[d.dayNumber] = d.points;
  return {
    durationDays: challenge.durationDays,
    pointsDone: challenge.pointsDone,
    pointsProof: challenge.pointsProof,
    pointsViolation: challenge.pointsViolation,
    streakSaveCost: challenge.streakSaveCost,
    dayPoints,
  };
}

export function currentDayOf(e: { user: Pick<User, "timezone">; stream: Pick<Stream, "startDate"> }, now = new Date()) {
  return dayNumber(e.stream.startDate, now, e.user.timezone || config.defaultTimezone);
}

/** Статус потока по московскому времени (для админки и выбора потока при оплате) */
export function streamPhase(stream: Pick<Stream, "startDate">, durationDays: number, now = new Date()) {
  const d = dayNumber(stream.startDate, now, config.defaultTimezone);
  if (d < 1) return "UPCOMING" as const;
  if (d > durationDays) return "FINISHED" as const;
  return "RUNNING" as const;
}

export async function scoreEnrollment(e: EnrollmentFull, reports?: Report[], now = new Date()): Promise<ScoreResult> {
  const [reps, days] = await Promise.all([
    reports ?? prisma.report.findMany({ where: { enrollmentId: e.id } }),
    prisma.challengeDay.findMany({
      where: { challengeId: e.stream.challengeId },
      select: { dayNumber: true, points: true },
    }),
  ]);
  return computeScore(
    rulesOf(e.stream.challenge, days),
    currentDayOf(e, now),
    reps.map((r) => ({
      dayNumber: r.dayNumber,
      status: r.status,
      hasProof: Boolean(r.proofPhoto || (r.proofText && r.proofText.trim())),
      proofRejected: r.proofRejected,
    })),
    e.savedDays,
  );
}

/** Пересчитать и сохранить очки/серии участия */
export async function recomputeEnrollment(enrollmentId: number, now = new Date()) {
  const e = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: { user: true, stream: { include: { challenge: true } } },
  });
  if (!e) return null;
  const s = await scoreEnrollment(e, undefined, now);
  const finished = currentDayOf(e, now) > e.stream.challenge.durationDays;
  return prisma.enrollment.update({
    where: { id: e.id },
    data: {
      points: s.points,
      currentStreak: s.currentStreak,
      bestStreak: s.bestStreak,
      doneCount: s.doneCount,
      violatedCount: s.violatedCount,
      missedCount: s.missedCount,
      status: finished && e.status === "ACTIVE" ? "COMPLETED" : e.status,
    },
  });
}

/** Рейтинг потока: баллы, затем серия, затем число выполненных дней */
export async function streamLeaderboard(streamId: number) {
  const list = await prisma.enrollment.findMany({
    where: { streamId, status: { in: ["ACTIVE", "COMPLETED"] } },
    include: { user: true },
    orderBy: [{ points: "desc" }, { currentStreak: "desc" }, { doneCount: "desc" }, { createdAt: "asc" }],
  });
  return list.map((e, i) => ({
    rank: i + 1,
    enrollmentId: e.id,
    userId: e.userId,
    name: displayNameOf(e.user),
    photoUrl: e.user.photoUrl,
    points: e.points,
    currentStreak: e.currentStreak,
    bestStreak: e.bestStreak,
    doneCount: e.doneCount,
  }));
}

export function displayNameOf(u: Pick<User, "displayName" | "firstName" | "username">) {
  return u.displayName || u.firstName || (u.username ? `@${u.username}` : "Участник");
}

/** Полное состояние участия для Mini App */
export async function enrollmentState(e: EnrollmentFull, now = new Date()) {
  const ch = e.stream.challenge;
  const tz = e.user.timezone || config.defaultTimezone;
  const day = currentDayOf(e, now);
  const reports = await prisma.report.findMany({ where: { enrollmentId: e.id }, orderBy: { dayNumber: "asc" } });
  const score = await scoreEnrollment(e, reports, now);
  const board = await streamLeaderboard(e.streamId);
  const me = board.find((b) => b.enrollmentId === e.id);
  const finished = day > ch.durationDays;
  const rewards = earnedRewards(score, { durationDays: ch.durationDays, finished, rank: me?.rank ?? null });
  const todayDay = day >= 1 && day <= ch.durationDays ? day : null;
  const todayTask = todayDay
    ? await prisma.challengeDay.findUnique({ where: { challengeId_dayNumber: { challengeId: ch.id, dayNumber: todayDay } } })
    : null;
  const todayReport = todayDay ? reports.find((r) => r.dayNumber === todayDay) ?? null : null;
  const startsAt = zonedMidnight(e.stream.startDate, tz);
  const canSaveStreak =
    score.streakBreakDay !== null && e.streakSavesUsed < ch.streakSavesAllowed && !e.savedDays.includes(score.streakBreakDay);

  return {
    enrollmentId: e.id,
    challenge: {
      id: ch.id,
      slug: ch.slug,
      title: ch.title,
      tagline: ch.tagline,
      rules: ch.rules,
      coverUrl: ch.coverUrl,
      durationDays: ch.durationDays,
      chatLink: ch.chatLink,
      pointsDone: ch.pointsDone,
      pointsProof: ch.pointsProof,
      pointsViolation: ch.pointsViolation,
      streakSaveCost: ch.streakSaveCost,
    },
    stream: { id: e.stream.id, startDate: e.stream.startDate, startsAt: startsAt.toISOString() },
    phase: day < 1 ? "upcoming" : finished ? "finished" : "running",
    today: localDate(now, tz),
    day,
    score: {
      points: score.points,
      currentStreak: score.currentStreak,
      bestStreak: score.bestStreak,
      doneCount: score.doneCount,
      violatedCount: score.violatedCount,
      missedCount: score.missedCount,
      dayStates: score.dayStates,
      bonusesEarned: score.bonusesEarned,
    },
    rank: me?.rank ?? null,
    participants: board.length,
    todayTask: todayTask && serializeDay(todayTask),
    todayReport: todayReport && serializeReport(todayReport),
    canSaveStreak,
    streakBreakDay: score.streakBreakDay,
    streakBeforeBreak: score.streakBeforeBreak,
    streakSavesLeft: Math.max(0, ch.streakSavesAllowed - e.streakSavesUsed),
    rewards: REWARDS.map((r) => ({ ...r, earned: rewards.has(r.code) })),
  };
}

export function serializeDay(d: ChallengeDay) {
  return {
    dayNumber: d.dayNumber,
    title: d.title,
    description: d.description,
    task: d.task,
    hint: d.hint,
    imageUrl: d.imageUrl,
    proofType: d.proofType,
    proofPrompt: d.proofPrompt,
    proofRequired: d.proofRequired,
    checklist: d.checklist,
  };
}

export function serializeReport(r: Report) {
  return {
    dayNumber: r.dayNumber,
    status: r.status,
    proofPhoto: r.proofPhoto,
    proofText: r.proofText,
    checklistDone: r.checklistDone,
    proofRejected: r.proofRejected,
  };
}

/**
 * Выбрать поток для нового участника: ближайший будущий с открытой записью,
 * иначе идущий сейчас с открытой записью.
 */
export async function pickStreamForJoin(challengeId: number, now = new Date()) {
  const ch = await prisma.challenge.findUniqueOrThrow({ where: { id: challengeId } });
  const streams = await prisma.stream.findMany({
    where: { challengeId, enrollmentOpen: true },
    orderBy: { startDate: "asc" },
  });
  const upcoming = streams.find((s) => streamPhase(s, ch.durationDays, now) === "UPCOMING");
  if (upcoming) return upcoming;
  return streams.find((s) => streamPhase(s, ch.durationDays, now) === "RUNNING") ?? null;
}

/**
 * Выдать доступ к челленджу. Если пользователь уже в идущем или будущем потоке
 * этого челленджа, ничего не меняется. Иначе записываем в подходящий поток.
 * Возвращает участие (новое или существующее) или null, если открытого потока нет.
 */
export async function grantAccess(userId: number, challengeId: number, source: string, now = new Date()) {
  const ch = await prisma.challenge.findUniqueOrThrow({ where: { id: challengeId } });
  const existing = await prisma.enrollment.findMany({
    where: { userId, stream: { challengeId }, status: { in: ["ACTIVE"] } },
    include: { stream: true },
  });
  const live = existing.find((e) => streamPhase(e.stream, ch.durationDays, now) !== "FINISHED");
  if (live) return { enrollment: live, created: false, stream: live.stream };
  const stream = await pickStreamForJoin(challengeId, now);
  if (!stream) return null;
  const enrollment = await prisma.enrollment.upsert({
    where: { userId_streamId: { userId, streamId: stream.id } },
    create: { userId, streamId: stream.id, source },
    update: { status: "ACTIVE", source },
  });
  return { enrollment, created: true, stream };
}

/** Главное участие пользователя: идущее, затем ближайшее будущее, затем последнее завершённое */
export async function primaryEnrollment(userId: number, now = new Date()): Promise<EnrollmentFull | null> {
  const list = await prisma.enrollment.findMany({
    where: { userId, status: { in: ["ACTIVE", "COMPLETED"] } },
    include: { user: true, stream: { include: { challenge: true } } },
    orderBy: { stream: { startDate: "desc" } },
  });
  if (!list.length) return null;
  const withDay = list.map((e) => ({ e, day: currentDayOf(e, now), dur: e.stream.challenge.durationDays }));
  return (
    withDay.find((x) => x.day >= 1 && x.day <= x.dur)?.e ??
    [...withDay].reverse().find((x) => x.day < 1)?.e ??
    withDay[0].e
  );
}
