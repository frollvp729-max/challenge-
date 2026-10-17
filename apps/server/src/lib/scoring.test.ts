import { test } from "node:test";
import assert from "node:assert/strict";
import { computeScore, earnedRewards, type ReportInput, type ScoringRules } from "./scoring.js";
import { dayNumber, zonedMidnight, countdown } from "./dates.js";

const rules: ScoringRules = { durationDays: 30, pointsDone: 10, pointsProof: 5, pointsViolation: -10, streakSaveCost: 50 };
const done = (d: number, proof = false): ReportInput => ({ dayNumber: d, status: "DONE", hasProof: proof, proofRejected: false });
const viol = (d: number): ReportInput => ({ dayNumber: d, status: "VIOLATED", hasProof: false, proofRejected: false });

test("выполнение и доказательство дают 10 и 5 баллов, бонус за 3 дня", () => {
  const s = computeScore(rules, 4, [done(1, true), done(2), done(3, true)], []);
  assert.equal(s.currentStreak, 3);
  assert.equal(s.points, 15 + 10 + 15 + 10); // +10 бонус за 3 дня
  assert.deepEqual(s.dayStates.slice(0, 5), ["done_proof", "done", "done_proof", "today", "future"]);
});

test("нарушение снимает 10 баллов и обнуляет серию, прогресс сохраняется", () => {
  const s = computeScore(rules, 5, [done(1), done(2), done(3), viol(4)], []);
  assert.equal(s.currentStreak, 0);
  assert.equal(s.bestStreak, 3);
  assert.equal(s.doneCount, 3);
  assert.equal(s.points, 30 + 10 - 10);
  assert.equal(s.streakBreakDay, 4);
  assert.equal(s.streakBeforeBreak, 3);
});

test("пропуск дня обнуляет серию, сегодня без отчёта не считается пропуском", () => {
  const s = computeScore(rules, 3, [done(1)], []);
  assert.equal(s.missedCount, 1);
  assert.equal(s.currentStreak, 0);
  assert.equal(s.dayStates[2], "today");
});

test("спасённая серия продолжается, стоит 50 баллов", () => {
  const reps = [1, 2, 3, 4, 5, 6, 7].map((d) => done(d));
  const s = computeScore(rules, 10, [...reps, done(9)], [8]);
  assert.equal(s.currentStreak, 8);
  assert.equal(s.dayStates[7], "saved");
  // 8 выполнений *10 + бонусы 3 и 7 дней (10+25) − 50
  assert.equal(s.points, 80 + 35 - 50);
});

test("бонус за порог серии даётся один раз", () => {
  const reps = [done(1), done(2), done(3), viol(4), done(5), done(6), done(7)];
  const s = computeScore(rules, 8, reps, []);
  assert.deepEqual(s.bonusesEarned, [3]);
});

test("отклонённое доказательство не даёт +5", () => {
  const s = computeScore(rules, 2, [{ dayNumber: 1, status: "DONE", hasProof: true, proofRejected: true }], []);
  assert.equal(s.points, 10);
  assert.equal(s.dayStates[0], "done");
});

test("30 из 30 — все награды серий и «без пропуска»", () => {
  const reps = Array.from({ length: 30 }, (_, i) => done(i + 1, true));
  const s = computeScore(rules, 31, reps, []);
  assert.equal(s.points, 30 * 15 + 10 + 25 + 50 + 75 + 150);
  const r = earnedRewards(s, { durationDays: 30, finished: true, rank: 3 });
  for (const code of ["first_day", "streak_7", "streak_14", "streak_21", "finished", "perfect", "top_10"]) assert.ok(r.has(code), code);
});

test("номер дня и обратный отсчёт по таймзоне", () => {
  const now = new Date("2026-10-19T21:30:00Z"); // 00:30 20 октября в Москве
  assert.equal(dayNumber("2026-10-20", now, "Europe/Moscow"), 1);
  assert.equal(dayNumber("2026-10-20", now, "Europe/London"), 0);
  assert.equal(zonedMidnight("2026-10-20", "Europe/Moscow").toISOString(), "2026-10-19T21:00:00.000Z");
  assert.equal(countdown((2 * 86400 + 6 * 3600 + 42 * 60 + 18) * 1000), "2 дня 06:42:18");
});
