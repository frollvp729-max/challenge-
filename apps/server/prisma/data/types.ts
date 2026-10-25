/** Готовое наполнение челленджа: тексты и 30 дней. Загружается seed'ом в черновик с тем же slug. */

export type DayContent = {
  title: string;
  /** Подготовка и как выполнять (переносы строк сохраняются в Mini App) */
  description: string;
  /** Само задание дня, его же бот присылает утром */
  task: string;
  hint: string;
  proofPrompt: string;
  proofType?: string;
  checklist?: string[];
};

export type ChallengeContent = {
  slug: string;
  title: string;
  tagline: string;
  intro: string;
  rules: string;
  days: DayContent[];
};

const SCORING = `Баллы
+10 за выполнение, +5 за отчёт с текстом или фото, −10 за нарушение.
Бонусы за серию: 3 дня +10, 7 дней +25, 14 дней +50, 21 день +75, 30 дней +150.

Срыв
Серия обнуляется, но выполненные дни сохраняются и челлендж продолжается. Один раз за челлендж серию можно спасти за 50 баллов.`;

/** Правила: общий порядок, особые правила челленджа, безопасность (если есть), баллы */
export function buildRules(opts: { how: string[]; main: string[]; safety?: string }): string {
  const parts = [
    "Как проходит челлендж",
    "",
    "• 30 дней, каждый день одно задание. Утром бот пришлёт его, вечером напомнит, если отчёта нет.",
    "• День закрывается в полночь по твоему времени.",
    ...opts.how.map((l) => `• ${l}`),
    "",
    "Главные правила",
    ...opts.main.map((l) => `• ${l}`),
  ];
  if (opts.safety) parts.push("", "Безопасность", opts.safety);
  parts.push("", SCORING);
  return parts.join("\n");
}

/** Описание дня из блоков «Подготовка» и «Как выполнять» с нумерацией шагов */
export function steps(intro: string | null, prep: string[], doIt: string[]): string {
  const out: string[] = [];
  if (intro) out.push(intro, "");
  if (prep.length) out.push("Подготовка", ...prep.map((s, i) => `${i + 1}. ${s}`), "");
  out.push("Как выполнять", ...doIt.map((s, i) => `${i + 1}. ${s}`));
  return out.join("\n");
}
