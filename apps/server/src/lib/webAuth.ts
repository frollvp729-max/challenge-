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
  /** id пользователя в нашей базе после подтверждения в боте */
  userId?: number;
}

const pending = new Map<string, LoginRequest>();

function purge(now = Date.now()) {
  for (const [code, r] of pending) if (r.expiresAt < now) pending.delete(code);
}

export function createLoginCode(): string {
  purge();
  // защита от переполнения памяти: самые старые коды уходят первыми
  while (pending.size >= MAX_PENDING) pending.delete(pending.keys().next().value!);
  const code = crypto.randomBytes(18).toString("base64url");
  pending.set(code, { expiresAt: Date.now() + LOGIN_TTL_MS });
  return code;
}

/** Код существует и ещё не подтверждён */
export function isLoginCodeOpen(code: string): boolean {
  const r = pending.get(code);
  return Boolean(r && r.expiresAt >= Date.now() && r.userId === undefined);
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
