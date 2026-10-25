import type { Challenge, ChallengeDay, Enrollment, Report, Stream, User } from "@prisma/client";
import { prisma } from "../lib/db.js";
import { config } from "../config.js";
import { addDays, dayNumber, localDate, zonedMidnight } from "../lib/dates.js";
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

/** Личный номер дня участника: 1 в день его старта */
export function currentDayOf(e: Pick<Enrollment, "startDate"> & { user: Pick<User, "timezone"> }, now = new Date()) {
  return dayNumber(e.startDate, now, e.user.timezone || config.defaultTimezone);
}

/**
 * День старта для нового участника: до даты открытия — дата открытия,
 * после неё — следующий день после записи (по времени участника).
 */
export function joinStartDate(ch: Pick<Challenge, "startDate">, tz: string, now = new Date()): string {
  const tomorrow = addDays(localDate(now, tz || config.defaultTimezone), 1);
  return ch.startDate && ch.startDate > tomorrow ? ch.startDate : tomorrow;
}

/** Служебный поток челленджа, в который попадают все новые участия */
export async function mainStream(ch: Pick<Challenge, "id" | "startDate">): Promise<Stream> {
  const s = await prisma.stream.findFirst({ where: { challengeId: ch.id }, orderBy: { id: "asc" } });
  if (s) return s;
  return prisma.stream.create({
    data: { challengeId: ch.id, title: "Бессрочный", startDate: ch.startDate ?? localDate(new Date(), config.defaultTimezone) },
  });
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

type BoardRow = {
  rank: number;
  enrollmentId: number;
  userId: number;
  name: string;
  photoUrl: string | null;
  points: number;
  currentStreak: number;
  bestStreak: number;
  doneCount: number;
  /** Личный день участника (не больше длительности) */
  day: number;
  finished: boolean;
};

/** Один ряд на человека: у смотрящего — его текущее участие, у остальных — лучший круг */
function rankRows<T extends { enrollmentId: number; userId: number; points: number; currentStreak: number; doneCount: number; createdAt: Date }>(
  rows: T[],
  viewerEnrollmentId?: number,
): Array<T & { rank: number }> {
  const viewer = rows.find((r) => r.enrollmentId === viewerEnrollmentId);
  const best = new Map<number, T>();
  for (const r of rows) {
    if (viewer && r.userId === viewer.userId) continue;
    const cur = best.get(r.userId);
    if (!cur || r.points > cur.points) best.set(r.userId, r);
  }
  const list = [...best.values(), ...(viewer ? [viewer] : [])];
  list.sort(
    (a, b) =>
      b.points - a.points ||
      b.currentStreak - a.currentStreak ||
      b.doneCount - a.doneCount ||
      a.createdAt.getTime() - b.createdAt.getTime(),
  );
  return list.map((r, i) => ({ ...r, rank: i + 1 }));
}

/**
 * Общий рейтинг челленджа: все, кто уже начал свои 30 дней, в любое время.
 * Баллы, затем серия, затем число выполненных дней.
 */
export async function challengeLeaderboard(challengeId: number, viewerEnrollmentId?: number, now = new Date()): Promise<BoardRow[]> {
  const list = await prisma.enrollment.findMany({
    where: { stream: { challengeId }, status: { in: ["ACTIVE", "COMPLETED"] } },
    include: { user: true, stream: { select: { challenge: { select: { durationDays: true } } } } },
  });
  const rows = list
    .map((e) => {
      const dur = e.stream.challenge.durationDays;
      const day = currentDayOf(e, now);
      return {
        enrollmentId: e.id,
        userId: e.userId,
        name: displayNameOf(e.user),
        photoUrl: e.user.photoUrl,
        points: e.points,
        currentStreak: e.currentStreak,
        bestStreak: e.bestStreak,
        doneCount: e.doneCount,
        day: Math.min(day, dur),
        finished: day > dur,
        started: day >= 1,
        createdAt: e.createdAt,
      };
    })
    .filter((r) => r.started || r.enrollmentId === viewerEnrollmentId);
  return rankRows(rows, viewerEnrollmentId).map(({ createdAt: _c, started: _s, ...r }) => r);
}

/**
 * Сравнение на одном и том же личном дне: очки каждого за его дни 1…N,
 * где N — сегодняшний день смотрящего. В сравнение попадают те, кто день N уже прошёл.
 */
export async function sameDayLeaderboard(e: EnrollmentFull, now = new Date()) {
  const ch = e.stream.challenge;
  const n = Math.min(currentDayOf(e, now), ch.durationDays);
  if (n < 1) return { day: n, rows: [] as Array<Omit<BoardRow, "bestStreak" | "finished" | "day"> & { day: number }> };
  const [list, days] = await Promise.all([
    prisma.enrollment.findMany({
      where: { stream: { challengeId: ch.id }, status: { in: ["ACTIVE", "COMPLETED"] } },
      include: { user: true, reports: true },
    }),
    prisma.challengeDay.findMany({ where: { challengeId: ch.id }, select: { dayNumber: true, points: true } }),
  ]);
  const rules = rulesOf(ch, days);
  const rows = [];
  for (const x of list) {
    const isMe = x.id === e.id;
    if (!isMe && currentDayOf(x, now) <= n) continue;
    const s = computeScore(
      rules,
      isMe ? currentDayOf(x, now) : n + 1,
      x.reports
        .filter((r) => r.dayNumber <= n)
        .map((r) => ({
          dayNumber: r.dayNumber,
          status: r.status,
          hasProof: Boolean(r.proofPhoto || (r.proofText && r.proofText.trim())),
          proofRejected: r.proofRejected,
        })),
      x.savedDays.filter((d) => d <= n),
    );
    rows.push({
      enrollmentId: x.id,
      userId: x.userId,
      name: displayNameOf(x.user),
      photoUrl: x.user.photoUrl,
      points: s.points,
      currentStreak: s.currentStreak,
      doneCount: s.doneCount,
      day: n,
      createdAt: x.createdAt,
    });
  }
  return { day: n, rows: rankRows(rows, e.id).map(({ createdAt: _c, ...r }) => r) };
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
  const board = await challengeLeaderboard(ch.id, e.id, now);
  const me = board.find((b) => b.enrollmentId === e.id);
  const finished = day > ch.durationDays;
  const rewards = earnedRewards(score, { durationDays: ch.durationDays, finished, rank: me?.rank ?? null });
  const todayDay = day >= 1 && day <= ch.durationDays ? day : null;
  const todayTask = todayDay
    ? await prisma.challengeDay.findUnique({ where: { challengeId_dayNumber: { challengeId: ch.id, dayNumber: todayDay } } })
    : null;
  const todayReport = todayDay ? reports.find((r) => r.dayNumber === todayDay) ?? null : null;
  const startsAt = zonedMidnight(e.startDate, tz);
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
    /** Личный старт участника */
    stream: { id: e.stream.id, startDate: e.startDate, startsAt: startsAt.toISOString() },
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
 * Выдать доступ к челленджу. Если у пользователя уже есть идущий или будущий круг,
 * ничего не меняется. Иначе создаётся новый круг со старта на следующий день
 * (или в дату открытия челленджа, если она ещё не наступила).
 * renewal: продление подписки — следующий круг встаёт сразу после текущего.
 */
export async function grantAccess(
  userId: number,
  challengeId: number,
  source: string,
  now = new Date(),
  opts: { renewal?: boolean } = {},
) {
  const ch = await prisma.challenge.findUniqueOrThrow({ where: { id: challengeId } });
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const existing = await prisma.enrollment.findMany({
    where: { userId, stream: { challengeId }, status: "ACTIVE" },
    orderBy: { startDate: "asc" },
  });
  const live = existing.filter((e) => currentDayOf({ ...e, user }, now) <= ch.durationDays);
  let startDate = joinStartDate(ch, user.timezone, now);
  if (live.length) {
    const last = live[live.length - 1];
    const lastDay = currentDayOf({ ...last, user }, now);
    // уже есть круг впереди, или это не продление, — ничего не создаём
    if (!opts.renewal || live.length > 1 || lastDay < 1) return { enrollment: last, created: false, startDate: last.startDate };
    const after = addDays(last.startDate, ch.durationDays);
    if (after > startDate) startDate = after;
  }
  const stream = await mainStream(ch);
  const enrollment = await prisma.enrollment.upsert({
    where: { userId_streamId_startDate: { userId, streamId: stream.id, startDate } },
    create: { userId, streamId: stream.id, startDate, source },
    update: { status: "ACTIVE", source },
  });
  return { enrollment, created: true, startDate };
}

/** Главное участие пользователя: идущее, затем ближайшее будущее, затем последнее завершённое */
export async function primaryEnrollment(userId: number, now = new Date()): Promise<EnrollmentFull | null> {
  const list = await prisma.enrollment.findMany({
    where: { userId, status: { in: ["ACTIVE", "COMPLETED"] } },
    include: { user: true, stream: { include: { challenge: true } } },
    orderBy: { startDate: "desc" },
  });
  if (!list.length) return null;
  const withDay = list.map((e) => ({ e, day: currentDayOf(e, now), dur: e.stream.challenge.durationDays }));
  return (
    withDay.find((x) => x.day >= 1 && x.day <= x.dur)?.e ??
    [...withDay].reverse().find((x) => x.day < 1)?.e ??
    withDay[0].e
  );
}
