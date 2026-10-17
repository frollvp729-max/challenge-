/** Работа с датами в таймзоне участника. Даты дней храним строками YYYY-MM-DD. */

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function parts(date: Date, tz: string) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const p: Record<string, string> = {};
  for (const x of fmt.formatToParts(date)) p[x.type] = x.value;
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    hour: Number(p.hour),
    minute: Number(p.minute),
    second: Number(p.second),
  };
}

/** Локальная дата YYYY-MM-DD в таймзоне */
export function localDate(now: Date, tz: string): string {
  return parts(now, tz).date;
}

/** Локальный час 0..23 в таймзоне */
export function localHour(now: Date, tz: string): number {
  return parts(now, tz).hour;
}

/** Разница в днях между двумя датами YYYY-MM-DD (b - a) */
export function daysBetween(a: string, b: string): number {
  const ta = Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10));
  const tb = Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10));
  return Math.round((tb - ta) / 86_400_000);
}

export function addDays(date: string, n: number): string {
  const t = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * Номер дня челленджа для участника: 1 в день старта,
 * 0 и меньше — до старта, больше длительности — челлендж закончился.
 */
export function dayNumber(startDate: string, now: Date, tz: string): number {
  return daysBetween(startDate, localDate(now, tz)) + 1;
}

/** Момент локальной полуночи даты YYYY-MM-DD в таймзоне, в UTC */
export function zonedMidnight(date: string, tz: string): Date {
  const guess = new Date(`${date}T00:00:00Z`);
  // смещение таймзоны в этот момент
  const p = parts(guess, tz);
  const asUtc = Date.UTC(+p.date.slice(0, 4), +p.date.slice(5, 7) - 1, +p.date.slice(8, 10), p.hour, p.minute, p.second);
  const offset = asUtc - guess.getTime();
  return new Date(guess.getTime() - offset);
}

const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

/** «20 октября» */
export function humanDate(date: string): string {
  return `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`;
}

export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

/** «2 дня 06:42:18» */
export function countdown(ms: number): string {
  if (ms <= 0) return "0 дней 00:00:00";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${d} ${plural(d, "день", "дня", "дней")} ${pad(h)}:${pad(m)}:${pad(sec)}`;
}
