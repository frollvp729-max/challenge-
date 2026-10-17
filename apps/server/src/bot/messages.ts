import { InlineKeyboard } from "grammy";
import type { Challenge, Stream } from "@prisma/client";
import { config } from "../config.js";
import { countdown, humanDate, zonedMidnight } from "../lib/dates.js";

/** Экранирование для parse_mode=HTML */
export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function appUrl(params: Record<string, string> = {}) {
  const q = new URLSearchParams(params).toString();
  return config.webAppUrl + (q ? `?${q}` : "");
}

export function openAppKeyboard(text = "ОТКРЫТЬ ПРИЛОЖЕНИЕ", params: Record<string, string> = {}) {
  return new InlineKeyboard().webApp(text, appUrl(params));
}

export function introMessage(ch: Challenge) {
  const text =
    ch.intro?.trim() ||
    `<b>${esc(ch.title)}</b>\n${esc(ch.tagline)}\n\nКаждый день — небольшое задание.\nОтчёт занимает 30 секунд.\nУчастники соревнуются за место в рейтинге и получают награды.`;
  return { text, keyboard: new InlineKeyboard().text("УЧАСТВОВАТЬ", `join:${ch.id}`) };
}

export function priceMessage(ch: Challenge, stream: Stream | null) {
  const lines = [`<b>${esc(ch.title)}</b>`, "", `Стоимость участия — <b>${ch.priceRub} ₽</b>`];
  if (ch.paymentMode === "SUBSCRIPTION") {
    lines.push("Оплата через Tribute, подписка продлевается автоматически раз в месяц. Отменить можно в любой момент в @tribute.");
  }
  if (stream) lines.push("", `Старт: ${humanDate(stream.startDate)}`);
  const kb = new InlineKeyboard();
  if (ch.tributeLink) kb.url(`ОПЛАТИТЬ ${ch.priceRub} ₽`, ch.tributeLink);
  return { text: lines.join("\n"), keyboard: kb };
}

export function paidMessage(stream: Stream, tz: string, now = new Date()) {
  const startsAt = zonedMidnight(stream.startDate, tz);
  const left = startsAt.getTime() - now.getTime();
  const lines = ["Оплата получена.", "Ты в челлендже.", `Старт: ${humanDate(stream.startDate)}`];
  if (left > 0) lines.push(`До старта: ${countdown(left)}`);
  else lines.push("Челлендж уже идёт, присоединяйся прямо сегодня.");
  return { text: lines.join("\n"), keyboard: openAppKeyboard() };
}

export function morningMessage(opts: {
  day: number;
  duration: number;
  taskTitle: string;
  taskText: string;
  bestStreak: number;
  currentStreak: number;
  missedYesterday: boolean;
}) {
  const { day, duration } = opts;
  const lines: string[] = [];
  if (opts.missedYesterday) {
    lines.push("Вчера отчёт не был отправлен.", "Серия прервана.", "Но челлендж продолжается.", "");
    lines.push(`<b>День ${day}/${duration}</b>`, "Сегодня можно начать новую серию.", "");
  } else {
    lines.push(`<b>ДЕНЬ ${day}/${duration}</b>`, "");
  }
  lines.push("Сегодняшняя задача:", `<b>${esc(opts.taskTitle)}</b>`);
  if (opts.taskText) lines.push(esc(opts.taskText));
  if (!opts.missedYesterday && opts.bestStreak > 0) {
    lines.push("", `Твой рекорд: 🔥 ${opts.bestStreak}.`);
    if (opts.currentStreak > 0) lines.push("Не прерывай серию.");
  }
  return {
    text: lines.join("\n"),
    keyboard: openAppKeyboard(opts.missedYesterday ? "ПРОДОЛЖИТЬ" : "ОТКРЫТЬ ЗАДАНИЕ", { screen: "today" }),
  };
}

export function eveningMessage(hoursLeft: number, currentStreak: number) {
  const lines = ["Сегодня ещё можно выполнить задание.", `До закрытия дня осталось ${hoursLeft} ч.`];
  if (currentStreak > 0) lines.push(`Твоя серия: 🔥 ${currentStreak}.`, "Не потеряй её.");
  return { text: lines.join("\n"), keyboard: openAppKeyboard("ОТЧИТАТЬСЯ", { screen: "today" }) };
}

export function finishedMessage(title: string, done: number, duration: number, points: number, rank: number | null) {
  const lines = [
    "<b>ЧЕЛЛЕНДЖ ЗАВЕРШЁН</b>",
    `«${esc(title)}»`,
    "",
    `${done} / ${duration} дней`,
    rank ? `🏆 Итоговое место: #${rank}` : "",
    `⭐ Баллы: ${points}`,
    "",
    "Забери сертификат в приложении.",
  ].filter((x) => x !== "");
  return { text: lines.join("\n"), keyboard: openAppKeyboard("ПОЛУЧИТЬ СЕРТИФИКАТ", { screen: "final" }) };
}
