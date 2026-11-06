import crypto from "node:crypto";

/**
 * Вход на сайт (обычный браузер) через бота.
 * Сайт получает одноразовый код и ссылку t.me/<бот>?start=login_<код>.
 * Человек открывает ссылку в Telegram, бот просит подтвердить вход,
 * после подтверждения сайт забирает подписанный токен сессии.
 * Аккаунт тот же, что в Mini App: пользователь определяется по Telegram ID.
 */

const LOGIN_TTL_MS = 10 * 60 * 1000;
const MAX_PENDING = 5000;
export const SESSION_TTL_SEC = 90 * 24 * 3600;

interface LoginRequest {
  expiresAt: number;
  /** Подключение Telegram к уже открытому аккаунту сайта (id этого аккаунта) */
  linkUserId?: number;
  /** id пользователя в нашей базе после подтверждения в боте */
  userId?: number;
}

const pending = new Map<string, LoginRequest>();

function purge(now = Date.now()) {
  for (const [code, r] of pending) if (r.expiresAt < now) pending.delete(code);
}

export function createLoginCode(linkUserId?: number): string {
  purge();
  // защита от переполнения памяти: самые старые коды уходят первыми
  while (pending.size >= MAX_PENDING) pending.delete(pending.keys().next().value!);
  const code = crypto.randomBytes(18).toString("base64url");
  pending.set(code, { expiresAt: Date.now() + LOGIN_TTL_MS, linkUserId });
  return code;
}

/** Код существует и ещё не подтверждён */
export function isLoginCodeOpen(code: string): boolean {
  const r = pending.get(code);
  return Boolean(r && r.expiresAt >= Date.now() && r.userId === undefined);
}

/** Для какого аккаунта сайта этот код подключает Telegram (undefined — обычный вход) */
export function linkTargetOf(code: string): number | undefined {
  return pending.get(code)?.linkUserId;
}

/** Бот подтвердил вход: привязать код к пользователю */
export function confirmLoginCode(code: string, userId: number): boolean {
  if (!isLoginCodeOpen(code)) return false;
  pending.get(code)!.userId = userId;
  return true;
}

export function cancelLoginCode(code: string) {
  pending.delete(code);
}

/**
 * Состояние кода для сайта. После «confirmed» код удаляется:
 * токен выдаётся один раз.
 */
export function takeLoginCode(code: string): { status: "pending" } | { status: "expired" } | { status: "confirmed"; userId: number } {
  const r = pending.get(code);
  if (!r || r.expiresAt < Date.now()) {
    pending.delete(code);
    return { status: "expired" };
  }
  if (r.userId === undefined) return { status: "pending" };
  pending.delete(code);
  return { status: "confirmed", userId: r.userId };
}

function sessionKey(botToken: string) {
  return crypto.createHmac("sha256", "WebSession").update(botToken).digest();
}

/** Токен сессии сайта: w1.<userId>.<exp>.<подпись> */
export function signWebSession(userId: number, botToken: string, ttlSec = SESSION_TTL_SEC): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const body = `w1.${userId}.${exp}`;
  const sig = crypto.createHmac("sha256", sessionKey(botToken)).update(body).digest("base64url");
  return `${body}.${sig}`;
}

// ---------------- Аккаунт сайта: почта и пароль ----------------

export function normalizeEmail(raw: unknown): string | null {
  const email = String(raw ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 120 ? email : null;
}

/** scrypt с солью: s1$<соль>$<хеш> */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32);
  return ["s1", salt.toString("base64url"), hash.toString("base64url")].join("$");
}

export function checkPassword(password: string, stored: string | null): boolean {
  if (!stored) return false;
  const [v, saltStr, hashStr] = stored.split("$");
  if (v !== "s1" || !saltStr || !hashStr) return false;
  const expected = Buffer.from(hashStr, "base64url");
  const actual = crypto.scryptSync(password, Buffer.from(saltStr, "base64url"), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

/** Простое ограничение попыток входа: не больше limit за 15 минут на ключ (почта или IP) */
const attempts = new Map<string, { count: number; until: number }>();
export function tooManyAttempts(key: string, limit = 10): boolean {
  const now = Date.now();
  const a = attempts.get(key);
  if (!a || a.until < now) {
    if (attempts.size > 20000) attempts.clear();
    attempts.set(key, { count: 1, until: now + 15 * 60 * 1000 });
    return false;
  }
  a.count++;
  return a.count > limit;
}
export function resetAttempts(key: string) {
  attempts.delete(key);
}

export function verifyWebSession(token: string, botToken: string): number | null {
  if (!token || !botToken) return null;
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "w1") return null;
  const [, idStr, expStr, sig] = parts;
  const expected = crypto.createHmac("sha256", sessionKey(botToken)).update(`w1.${idStr}.${expStr}`).digest("base64url");
  if (expected.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  if (Number(expStr) < Date.now() / 1000) return null;
  const id = Number(idStr);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// ---------------- Подписанные ссылки из писем ----------------

/**
 * Токен для ссылки: <тип>.<userId>.<exp>.<подпись>.
 * bind — то, что делает ссылку одноразовой: для сброса пароля это текущий хеш пароля
 * (после смены пароля старая ссылка перестаёт работать).
 */
export function signLinkToken(kind: "reset" | "unsub", userId: number, secret: string, bind = "", ttlSec = 3600): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const body = `${kind}.${userId}.${exp}`;
  const sig = crypto.createHmac("sha256", secret).update(`${body}.${bind}`).digest("base64url");
  return `${body}.${sig}`;
}

/** userId из токена ссылки или null. bindOf получает userId и возвращает то же значение bind, что при подписи. */
export async function verifyLinkToken(
  token: string,
  kind: "reset" | "unsub",
  secret: string,
  bindOf: (userId: number) => Promise<string | null>,
): Promise<number | null> {
  const parts = String(token ?? "").split(".");
  if (parts.length !== 4 || parts[0] !== kind || !secret) return null;
  const [, idStr, expStr, sig] = parts;
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0 || Number(expStr) < Date.now() / 1000) return null;
  const bind = await bindOf(id);
  if (bind === null) return null;
  const expected = crypto.createHmac("sha256", secret).update(`${kind}.${idStr}.${expStr}.${bind}`).digest("base64url");
  if (expected.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  return id;
}
