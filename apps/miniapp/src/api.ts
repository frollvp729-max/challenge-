const tg = () => window.Telegram?.WebApp;

/** Открыто внутри Telegram (Mini App), а не в обычном браузере */
export const inTelegram = () => Boolean(tg()?.initData);

/** В браузере без Telegram можно открыть /app/?dev=<telegramId> (если на сервере DEV_AUTH=1) */
const devUser = new URLSearchParams(location.search).get("dev");

// Сайт в обычном браузере: токен сессии после входа через бота
const SESSION_KEY = "webSession";
export function webSession(): string | null {
  try {
    return localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}
export function setWebSession(token: string | null) {
  try {
    if (token) localStorage.setItem(SESSION_KEY, token);
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* без хранилища вход продержится до перезагрузки страницы */
  }
  memorySession = token;
}
let memorySession: string | null = null;

/** Выйти на сайте (в Telegram выход не нужен) */
export function logout() {
  setWebSession(null);
  location.reload();
}

/** Нужен экран входа: обычный браузер и нет сессии */
export const needsLogin = () => !inTelegram() && !devUser && !(webSession() ?? memorySession);

function headers(): Record<string, string> {
  const initData = tg()?.initData;
  if (initData) return { authorization: `tma ${initData}` };
  if (devUser) return { "x-dev-user": devUser };
  const session = webSession() ?? memorySession;
  if (session) return { authorization: `web ${session}` };
  return {};
}

/** Сессия сайта истекла или недействительна: приложение покажет экран входа */
let onUnauthorized: () => void = () => undefined;
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function handle<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !inTelegram() && !devUser) {
    setWebSession(null);
    onUnauthorized();
  }
  if (!res.ok) throw new ApiError(res.status, data.error ?? "Ошибка сети");
  return data as T;
}

export const api = {
  get: <T,>(path: string) => fetch(`/api${path}`, { headers: headers() }).then((r) => handle<T>(r)),
  post: <T,>(path: string, body?: unknown) =>
    fetch(`/api${path}`, {
      method: "POST",
      headers: { ...headers(), "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    }).then((r) => handle<T>(r)),
  upload: <T,>(path: string, file: Blob, name: string, fields: Record<string, string> = {}) => {
    const fd = new FormData();
    // поля идут перед файлом, чтобы сервер прочитал их вместе с файлом
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    fd.append("file", file, name);
    return fetch(`/api${path}`, { method: "POST", headers: headers(), body: fd }).then((r) => handle<T>(r));
  },
};

export type DayState = "done_proof" | "done" | "violated" | "missed" | "saved" | "today" | "future";

export interface User {
  id: number;
  /** Пусто у аккаунта сайта, к которому не подключён Telegram */
  telegramId: string | null;
  /** Почта для входа на сайте, если задана */
  email: string | null;
  username: string | null;
  firstName: string | null;
  photoUrl: string | null;
  displayName: string | null;
  age: number | null;
  country: string | null;
  goal: string | null;
  goalOther: string | null;
  timezone: string;
  onboarded: boolean;
  /** Организатор участвует в любом челлендже бесплатно */
  isOrganizer: boolean;
}

export interface Me {
  user: User;
  botUsername: string;
  primaryEnrollmentId: number | null;
  enrollments: MyEnrollment[];
}

export type Phase = "upcoming" | "running" | "finished";

/** Участие в одном челлендже (их может быть несколько одновременно) */
export interface MyEnrollment {
  id: number;
  challengeId: number;
  challengeTitle: string;
  durationDays: number;
  startDate: string;
  status: string;
  points: number;
  phase: Phase;
  day: number;
}

export interface DayTask {
  dayNumber: number;
  title: string;
  description: string;
  task: string;
  hint: string;
  imageUrl: string | null;
  proofType: "none" | "photo" | "text" | "photo_or_text";
  proofPrompt: string;
  proofRequired: boolean;
  checklist: string[];
}

export interface DayReport {
  dayNumber: number;
  status: "DONE" | "VIOLATED";
  proofPhoto: string | null;
  proofText: string | null;
  checklistDone: string[];
  proofRejected: boolean;
}

export interface Reward {
  code: string;
  icon: string;
  title: string;
  description: string;
  earned: boolean;
}

export interface State {
  enrollmentId: number;
  challenge: {
    id: number;
    slug: string;
    title: string;
    tagline: string;
    rules: string;
    coverUrl: string | null;
    durationDays: number;
    chatLink: string | null;
    chatEnabled: boolean;
    pointsDone: number;
    pointsProof: number;
    pointsViolation: number;
    streakSaveCost: number;
  };
  /** Личный старт участника: у каждого свои 30 дней */
  stream: { id: number; startDate: string; startsAt: string };
  phase: Phase;
  today: string;
  day: number;
  score: {
    points: number;
    currentStreak: number;
    bestStreak: number;
    doneCount: number;
    violatedCount: number;
    missedCount: number;
    dayStates: DayState[];
    bonusesEarned: number[];
  };
  rank: number | null;
  participants: number;
  todayTask: DayTask | null;
  todayReport: DayReport | null;
  canSaveStreak: boolean;
  streakBreakDay: number | null;
  streakBeforeBreak: number;
  streakSavesLeft: number;
  rewards: Reward[];
}

export interface LeaderRow {
  rank: number;
  enrollmentId: number;
  name: string;
  photoUrl: string | null;
  points: number;
  currentStreak: number;
  bestStreak: number;
  doneCount: number;
  /** Личный день участника */
  day: number;
  finished?: boolean;
  isMe?: boolean;
  /** В скольких челленджах человек участвует сейчас (без названий) */
  challenges?: number;
}

export interface LeaderboardData {
  top: LeaderRow[];
  me: LeaderRow | null;
  total: number;
  /** Сравнение на одном и том же личном дне */
  sameDay: { day: number; top: LeaderRow[]; me: LeaderRow | null; total: number };
}

export interface CatalogItem {
  id: number;
  slug: string;
  title: string;
  tagline: string;
  coverUrl: string | null;
  priceRub: number;
  paymentMode: string;
  tributeLink: string | null;
  nextStart: string | null;
  joined: { enrollmentId: number; phase: Phase; startDate: string } | null;
  /** Черновик: виден только организатору */
  draft: boolean;
  /** Заявка «Я оплатил переводом» ждёт подтверждения */
  cardPending: boolean;
}

/** Реквизиты для перевода на карту */
export interface CardSettings {
  number: string;
  holder: string;
  bank: string;
  note: string;
}

export interface ChatMessage {
  id: number;
  text: string;
  photoUrl: string | null;
  deleted: boolean;
  createdAt: string;
  author: {
    userId: number | null;
    name: string;
    photoUrl: string | null;
    organizer: boolean;
    isMe: boolean;
    /** «день 5», «скоро старт», «прошёл 30 дней» */
    badge: string | null;
    /** В скольких челленджах автор участвует сейчас (без названий) */
    challenges?: number;
  };
  replyTo: { id: number; name: string; text: string } | null;
}

export interface ChatPage {
  challengeTitle: string;
  messages: ChatMessage[];
  deletedIds: number[];
  hasMore: boolean;
  members?: number;
  banned: boolean;
}

export interface ChatSummary {
  enabled: boolean;
  unread?: number;
  members?: number;
  last?: { name: string; text: string; createdAt: string } | null;
}
