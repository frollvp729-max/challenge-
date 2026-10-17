/**
 * Подсчёт очков, серий и наград. Чистые функции без БД: всё считается заново
 * из отчётов, поэтому правка задания или отклонение доказательства в админке
 * сразу корректно отражается в рейтинге.
 */

/** Бонусы за серию: длина серии → баллы. Каждый порог даётся один раз за челлендж. */
export const STREAK_BONUSES: Array<[number, number]> = [
  [3, 10],
  [7, 25],
  [14, 50],
  [21, 75],
  [30, 150],
];

export type DayState =
  | "done_proof" // 🟢 выполнил + доказательство
  | "done" // 🟡 выполнил без доказательства
  | "violated" // 🔴 нарушил
  | "missed" // не отчитался
  | "saved" // пропуск/нарушение, но серия спасена
  | "today" // сегодня, отчёта ещё нет
  | "future";

export interface ReportInput {
  dayNumber: number;
  status: "DONE" | "VIOLATED";
  hasProof: boolean;
  proofRejected: boolean;
}

export interface ScoringRules {
  durationDays: number;
  pointsDone: number;
  pointsProof: number;
  pointsViolation: number;
  streakSaveCost: number;
  /** Переопределения очков за выполнение по дням */
  dayPoints?: Record<number, number | null | undefined>;
}

export interface ScoreResult {
  points: number;
  currentStreak: number;
  bestStreak: number;
  doneCount: number;
  violatedCount: number;
  missedCount: number;
  dayStates: DayState[]; // индекс 0 = день 1
  /** Сколько очков из бонусов за серии */
  bonusPoints: number;
  bonusesEarned: number[];
  /** Можно ли сейчас спасти серию: последний прошедший день сорван и до него была серия */
  streakBreakDay: number | null;
  streakBeforeBreak: number;
}

/**
 * @param currentDay номер текущего дня участника (может быть ≤0 до старта и > duration после)
 */
export function computeScore(
  rules: ScoringRules,
  currentDay: number,
  reports: ReportInput[],
  savedDays: number[],
): ScoreResult {
  const byDay = new Map(reports.map((r) => [r.dayNumber, r]));
  const saved = new Set(savedDays);
  const states: DayState[] = [];
  let points = 0;
  let run = 0;
  let best = 0;
  let done = 0;
  let violated = 0;
  let missed = 0;
  let bonusPoints = 0;
  const bonusesEarned: number[] = [];
  let lastBreakDay: number | null = null;
  let runBeforeLastBreak = 0;

  const awardBonuses = () => {
    for (const [len, bonus] of STREAK_BONUSES) {
      if (run >= len && !bonusesEarned.includes(len)) {
        bonusesEarned.push(len);
        bonusPoints += bonus;
      }
    }
  };

  for (let d = 1; d <= rules.durationDays; d++) {
    if (d > currentDay) {
      states.push("future");
      continue;
    }
    const r = byDay.get(d);
    const isToday = d === currentDay;
    if (r && r.status === "DONE") {
      const base = rules.dayPoints?.[d] ?? rules.pointsDone;
      points += base;
      const proof = r.hasProof && !r.proofRejected;
      if (proof) points += rules.pointsProof;
      done++;
      run++;
      best = Math.max(best, run);
      awardBonuses();
      states.push(proof ? "done_proof" : "done");
      continue;
    }
    if (r && r.status === "VIOLATED") {
      points += rules.pointsViolation;
      violated++;
      if (saved.has(d)) {
        states.push("saved");
      } else {
        lastBreakDay = d;
        runBeforeLastBreak = run;
        run = 0;
        states.push("violated");
      }
      continue;
    }
    // отчёта нет
    if (isToday) {
      states.push("today");
      continue;
    }
    missed++;
    if (saved.has(d)) {
      states.push("saved");
    } else {
      lastBreakDay = d;
      runBeforeLastBreak = run;
      run = 0;
      states.push("missed");
    }
  }

  points += bonusPoints;
  points -= saved.size * rules.streakSaveCost;

  // Спасти серию можно только сразу: сорван вчерашний день (или сегодняшний — нарушением)
  // и после срыва ещё ничего не выполнено.
  let streakBreakDay: number | null = null;
  if (lastBreakDay !== null && runBeforeLastBreak > 0 && run === 0 && currentDay <= rules.durationDays) {
    if (lastBreakDay >= currentDay - 1) streakBreakDay = lastBreakDay;
  }

  return {
    points,
    currentStreak: run,
    bestStreak: best,
    doneCount: done,
    violatedCount: violated,
    missedCount: missed,
    dayStates: states,
    bonusPoints,
    bonusesEarned,
    streakBreakDay,
    streakBeforeBreak: streakBreakDay !== null ? runBeforeLastBreak : 0,
  };
}

export interface RewardDef {
  code: string;
  icon: string;
  title: string;
  description: string;
}

export const REWARDS: RewardDef[] = [
  { code: "first_day", icon: "🏅", title: "Первый день", description: "Выполнил первое задание." },
  { code: "streak_7", icon: "🔥", title: "7 дней", description: "Серия 7 дней." },
  { code: "streak_14", icon: "💪", title: "14 дней", description: "Две недели без пропуска." },
  { code: "streak_21", icon: "🏆", title: "21 день", description: "Сформировал устойчивую серию." },
  { code: "finished", icon: "👑", title: "30 дней", description: "Полностью завершил челлендж." },
  { code: "perfect", icon: "⚡", title: "Без единого пропуска", description: "Все дни выполнены, ни одного срыва." },
  { code: "top_10", icon: "🥇", title: "ТОП-10", description: "Попал в десятку рейтинга." },
];

export function earnedRewards(
  score: Pick<ScoreResult, "doneCount" | "bestStreak" | "violatedCount" | "missedCount" | "dayStates">,
  opts: { durationDays: number; finished: boolean; rank: number | null },
): Set<string> {
  const got = new Set<string>();
  if (score.doneCount >= 1) got.add("first_day");
  if (score.bestStreak >= 7) got.add("streak_7");
  if (score.bestStreak >= 14) got.add("streak_14");
  if (score.bestStreak >= 21) got.add("streak_21");
  const last = score.dayStates[opts.durationDays - 1];
  if (last === "done" || last === "done_proof") got.add("finished");
  if (score.doneCount === opts.durationDays && score.violatedCount === 0 && score.missedCount === 0) got.add("perfect");
  if (opts.finished && opts.rank !== null && opts.rank <= 10) got.add("top_10");
  return got;
}
