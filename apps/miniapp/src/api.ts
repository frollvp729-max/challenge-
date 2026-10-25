const tg = () => window.Telegram?.WebApp;

/** В браузере без Telegram можно открыть /app/?dev=<telegramId> (если на сервере DEV_AUTH=1) */
const devUser = new URLSearchParams(location.search).get("dev");

function headers(): Record<string, string> {
  const initData = tg()?.initData;
  if (initData) return { authorization: `tma ${initData}` };
  if (devUser) return { "x-dev-user": devUser };
  return {};
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function handle<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
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
  upload: <T,>(path: string, file: Blob, name: string) => {
    const fd = new FormData();
    fd.append("file", file, name);
    return fetch(`/api${path}`, { method: "POST", headers: headers(), body: fd }).then((r) => handle<T>(r));
  },
};

export type DayState = "done_proof" | "done" | "violated" | "missed" | "saved" | "today" | "future";

export interface User {
  id: number;
  telegramId: string;
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
}
